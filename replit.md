# BNI Korea Power Team Referral Partner Scoreboard

## Overview

This is a full-stack web application designed for BNI Korea's Power Team referral partner management system. The application allows members to track and manage their referral partners through different stages (V, C, P) with progress tracking and achievement visualization. Built as a modern web application with a React frontend and Express backend, it features user authentication, data persistence, and real-time progress monitoring.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript using Vite as the build tool
- **UI Components**: Shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom CSS variables for theming
- **State Management**: TanStack Query (React Query) for server state management
- **Form Handling**: React Hook Form with Zod schema validation
- **Routing**: Wouter for lightweight client-side routing
- **Component Structure**: Modular component architecture with separate UI components, pages, and business logic hooks

### Backend Architecture
- **Runtime**: Node.js with Express.js framework
- **Language**: TypeScript with ES modules
- **API Design**: RESTful API endpoints for authentication and data management
- **Data Validation**: Zod schemas shared between frontend and backend
- **Error Handling**: Centralized error handling middleware
- **Development**: Hot reload with tsx and Vite integration

### Data Storage Solutions
- **Database**: PostgreSQL configured via Drizzle ORM
- **Schema Management**: Drizzle Kit for migrations and schema management
- **Storage Interface**: Abstract storage interface with in-memory implementation for development
- **Connection**: Neon Database serverless PostgreSQL connection
- **Data Models**: Users, scoreboard data, and change history tracking

### Authentication and Authorization
- **Authentication Method**: Email and 4-digit password system
- **Auto-registration**: New users are automatically registered on first login
- **Session Management**: Client-side user data persistence in localStorage
- **Security**: Simple password-based authentication suitable for internal team use
- **Google Sheets Authentication**: Service account-based OAuth2 authentication with googleapis library
  - Service Account: mypowerteam@qualified-glow-467905-k0.iam.gserviceaccount.com
  - Scopes: https://www.googleapis.com/auth/spreadsheets
  - Status: ✅ Active and functioning

### Key Features
- **Progress Tracking**: Visual achievement ring showing completion percentage toward 4-partner goal
- **Partner Management**: Single vertical form interface for managing up to 4 referral partners (reverted from tab layout)
- **Stage Tracking**: V (Visitor), C (Contact), P (Partner) stage progression
- **Achievement Rate Layout**: ✅ UPDATED (Aug 3, 2025)
  - Left side: Circular progress chart with percentage and ratio display
  - Right side: Partner statistics breakdown (P/C/V counts)
  - Bottom: "나의 총 리퍼럴 파트너 수" showing total partner count
- **Brand Color Update**: ✅ UPDATED (Aug 3, 2025)
  - Official BNI Korea brand color #d12031 (red) applied system-wide
  - Updated CSS variables for primary colors, buttons, progress indicators
  - Consistent color scheme across login, dashboard, and form components
- **Form Styling Consistency**: ✅ RESOLVED (Aug 3, 2025)
  - Unified placeholder text colors across all form fields using rgb(156 163 175)
  - User input text colors consistently dark using rgb(17 24 39)
  - Radix UI Select component styling issues completely resolved with nuclear CSS overrides
  - Browser autofill and focus blue color issues completely resolved with webkit overrides
  - "선택 안함" option added to relationship stage dropdown for clearing values
  - Applied to all existing users (biesy0011@naver.com, syoon850@gmail.com, info@bnikorea.com) and future users
- **Google Sheets Integration**: ✅ FULLY OPERATIONAL - Automatic sync to Google Sheets RPS tab (A1:U1 format)
  - Headers: 지역, 이메일, 챕터, 멤버, 업태명, 타겟고객, 나의 리펀 서비스, R파트너 1-4 with 전문분야 and V-C-P stages, 총 R파트너 수, 달성
  - ✅ UPDATED (Aug 3, 2025): "총 R파트너 수" now records only P-stage partners (not total partners)
  - Automatic calculation of P-stage partners and achievement percentage  
  - User-specific row updates with email-based identification
  - ✅ RESOLVED: Node.js v20/OpenSSL 3.x compatibility issues bypassed using googleapis library
  - ✅ SUCCESS: Real-time data synchronization working with service account authentication
  - Active spreadsheet: https://docs.google.com/spreadsheets/d/1JM37uOEu64D0r6zzKggOsA9ZdcK4wBCx0rpuNoVcIYg/edit
  - ✅ RESOLVED: Login page display issue caused by keyboard full-width character mode (전각문자)
  - ✅ ENHANCED: Seamless bidirectional auto-sync with Google Sheets every 5 seconds (no manual buttons needed)
- **Change History**: Audit trail of data modifications
- **Print Support**: Print-friendly layout for physical scoreboard display
- **Responsive Design**: Mobile-friendly interface with adaptive layouts

## External Dependencies

### UI and Styling
- Radix UI primitives for accessible component foundations
- Tailwind CSS for utility-first styling
- Lucide React for consistent iconography
- Class Variance Authority for component variant management

### Data and Forms
- TanStack Query for server state management and caching
- React Hook Form for form state management
- Zod for runtime type validation and schema definition
- Date-fns for date manipulation utilities

### Database and Backend
- Drizzle ORM for type-safe database operations
- Neon Database for serverless PostgreSQL hosting
- Express.js for HTTP server and API routing
- Connect-pg-simple for PostgreSQL session storage

### Development Tools
- Vite for fast development and building
- TypeScript for type safety
- ESBuild for production bundling
- Replit-specific plugins for development environment integration

### Potential Integrations
- Google Sheets API integration prepared for data synchronization
- Print functionality for physical scoreboard generation
- Real-time change notifications system architecture