import { Storage, File } from "@google-cloud/storage";
import { Response } from "express";
import { randomUUID } from "crypto";
import iconv from "iconv-lite";
import { NETWORK_CONFIG } from "./constants";

const REPLIT_SIDECAR_ENDPOINT = process.env.REPLIT_SIDECAR_ENDPOINT || `http://${NETWORK_CONFIG.REPLIT_SIDECAR_HOST}:${NETWORK_CONFIG.REPLIT_SIDECAR_PORT}`;

// The object storage client is used to interact with the object storage service.
export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// The object storage service is used to interact with the object storage service.
export class ObjectStorageService {
  constructor() {}

  // Gets the private object directory.
  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  // Gets the upload URL for a CSV file.
  async getCSVUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/csv/${objectId}.csv`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    // Sign URL for PUT method with TTL
    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  // Gets the CSV file from the object path.
  async getCSVFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/csv/")) {
      throw new ObjectNotFoundError();
    }

    const entityId = objectPath.slice(5); // Remove "/csv/"
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const csvObjectPath = `${entityDir}csv/${entityId}`;
    const { bucketName, objectName } = parseObjectPath(csvObjectPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  // Downloads a CSV file and returns its content as string
  async downloadCSVContent(file: File): Promise<string> {
    const stream = file.createReadStream();
    const chunks: Buffer[] = [];
    
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      stream.on('end', () => {
        const buffer = Buffer.concat(chunks);
        let content: string;
        
        console.log('📄 Raw buffer sample (first 20 bytes):', buffer.slice(0, 20));
        
        // Try different encodings to handle Korean text properly
        try {
          // First try UTF-8
          content = iconv.decode(buffer, 'utf-8');
          // Check if it contains replacement characters (indicates encoding issue)
          if (content.includes('�') || content.includes('��')) {
            throw new Error('UTF-8 decode failed');
          }
          console.log('✅ Successfully decoded as UTF-8');
        } catch (error) {
          try {
            // Try EUC-KR for Korean Windows files
            content = iconv.decode(buffer, 'euc-kr');
            console.log('✅ Successfully decoded as EUC-KR');
            // Check if still has issues
            if (content.includes('�')) {
              throw new Error('EUC-KR decode failed');
            }
          } catch (error2) {
            try {
              // Try CP949 (extended EUC-KR)
              content = iconv.decode(buffer, 'cp949');
              console.log('✅ Successfully decoded as CP949');
            } catch (error3) {
              // Last resort - try removing BOM and UTF-8
              let bomlessBuffer = buffer;
              if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
                bomlessBuffer = buffer.slice(3);
              }
              content = iconv.decode(bomlessBuffer, 'utf-8');
              console.log('⚠️  Fallback to UTF-8 without BOM');
            }
          }
        }
        
        console.log('📄 CSV content preview (first 200 chars):', content.substring(0, 200));
        resolve(content);
      });
      
      stream.on('error', (error) => {
        reject(error);
      });
    });
  }

  normalizeCSVPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }
  
    // Extract the path from the URL by removing query parameters and domain
    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;
  
    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }
  
    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }
  
    // Extract the entity ID from the path
    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/${entityId}`;
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = await response.json();
  return signedURL;
}