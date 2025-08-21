# BNI Korea Power Team Referral Partner Scoreboard

## Overview
This is a full-stack web application for BNI Korea's Power Team referral partner management. It enables members to track and manage referral partners through V, C, and P stages, visualize progress, and monitor achievements. The system features user authentication, data persistence, and real-time monitoring, aiming to streamline referral partner management for BNI Korea.

## User Preferences
Preferred communication style: Simple, everyday language.

## Recent Changes and Fixes
- **2025-08-21**: CONFIRMED: Bidirectional data synchronization working perfectly for specialty field
  - VERIFIED: Complete real-time sync functionality - App ↔ Google Sheets working flawlessly
  - Specialty field updates tested extensively: "건축업" → "건축업2" → "건축업3" → "최종테스트건축업" → "최종테스트건축업2" all successful
  - Root cause analysis completed: Google Sheets API has natural propagation delay but system functions correctly
  - Enhanced syncScoreboardData function with detailed logging for bidirectional fields
  - Added explicit bidirectional field update logic for specialty and targetCustomer
  - Implemented comprehensive debugging for Google Sheets ↔ Local Database sync
  - Fixed industry field text overflow with truncation and hover tooltips (removed duplicate browser tooltips)
  - Complete end-to-end functionality confirmed: App updates → Google Sheets → App reads updated values

- **2025-08-20**: Enhanced AI 시너지 매칭 멤버 system with two-tier matching approach
  - Added new API endpoints: `/api/chapter-synergy-members` and `/api/regional-businesses`
  - Implemented chapter-based member recommendations using keyword matching
  - Integrated Gemini API for regional business search functionality
  - Enhanced UI with two separate cards: "나의 챕터 내 시너지 멤버 추천" and "지역 내 시너지 업체 검색"
  - Automatic chapter member search when AI analysis completes
  - Manual regional business search with loading states and error handling
  
- **2025-08-10**: Fixed critical withdrawal processing bug where columns were being mapped incorrectly
  - Issue: STATUS column was correctly identified at index 24 (Y column), but email was duplicated at both index 0 (A column) and index 22 (W column)
  - Solution: Updated `markUserAsWithdrawn` function to read full range (A1:Z5000) and correctly target only STATUS column
  - Result: Withdrawal now only changes STATUS from "활동중" to "탈퇴" without affecting other fields

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript, using Vite.
- **UI Components**: Shadcn/ui (built on Radix UI) and Tailwind CSS for styling. Custom CSS variables for theming.
- **State Management**: TanStack Query for server state.
- **Form Handling**: React Hook Form with Zod validation.
- **Routing**: Wouter for client-side routing.
- **Component Structure**: Modular design with separate UI components, pages, and business logic hooks.
- **Key Features**:
    - Visual achievement ring for 4-partner goal progress.
    - Single vertical form for managing up to 4 referral partners.
    - V (Visitor), C (Contact), P (Partner) stage progression.
    - Achievement Rate Layout: Circular progress chart, partner statistics, and total partner count.
    - BNI Korea brand color (#d12031) applied system-wide.
    - Consistent form styling with unified placeholder and input text colors.
    - Enhanced login page with updated footer, consistent toast notifications, and brand-color styling.
    - Print Layout: Clean A4 print layout, Korean language attribute, and custom footer.
    - Data Integrity Control: Google Sheets-sourced fields are read-only to prevent corruption.
    - Auto-Save: Form changes auto-save to Google Sheets 2 seconds after modification for bidirectional fields.
    - Responsive design for mobile compatibility.

### Backend Architecture
- **Runtime**: Node.js with Express.js.
- **Language**: TypeScript with ES modules.
- **API Design**: RESTful API for authentication and data management.
- **Data Validation**: Zod schemas, shared with the frontend.
- **Error Handling**: Centralized middleware.

### Data Storage Solutions
- **Database**: PostgreSQL via Drizzle ORM.
- **Schema Management**: Drizzle Kit for migrations.
- **Storage Interface**: Abstract storage interface with in-memory development implementation.
- **Connection**: Neon Database serverless PostgreSQL.
- **Data Models**: Users, scoreboard data, and change history.

### Authentication and Authorization
- **Authentication Method**: Email and 4-digit password system.
- **Auto-registration**: New users registered on first login.
- **Session Management**: Client-side data persistence in localStorage.
- **Google Sheets Authentication**: Service account-based OAuth2 with `googleapis` library.
- **Authorization System**: Google Sheets AUTH column (26th column, Z) for role-based access. Admin roles: "Admin" and "Growth". Dynamic permission checking via `/api/admin/check-permission`.
- **User Management**: Single user addition and CSV upload for bulk user addition with error handling and encoding support (UTF-8/EUC-KR/CP4949). Real-time Google Sheets integration for data persistence. Smart row allocation reuses empty rows. Single unified dialog for user addition.
- **Withdrawal Process**: Users marked as "탈퇴" (withdrawn) in the STATUS field (25th column, Y), preserving all other data. **Fixed**: Withdrawal now correctly targets only STATUS column without affecting email, password, or auth fields.
- **Data Preservation**: Existing PW/STATUS values are preserved, missing fields get safe defaults.
- **Real-time Data Sync**: Cache prevention headers and timestamps for Google Sheets. Withdrawn users are automatically filtered from the member list. Bidirectional sync for certain fields (e.g., "전문분야," "나의 핵심 고객층").

### Key Features
- **Progress Tracking**: Visual achievement ring, V/C/P stage progression.
- **Partner Management**: Single vertical form.
- **Google Sheets Integration**: Automatic sync to Google Sheets RPS tab. Calculates P-stage partners and achievement percentage. User-specific row updates with email-based identification. Real-time data synchronization with service account authentication. Dynamic user management for additions/deletions, with smart row reallocation.
- **Change History**: Audit trail of data modifications.
- **Print Support**: Print-friendly layout.
- **Responsive Design**: Mobile-friendly interface.

## External Dependencies

### UI and Styling
- Radix UI primitives
- Tailwind CSS
- Lucide React (iconography)
- Class Variance Authority

### Data and Forms
- TanStack Query
- React Hook Form
- Zod
- Date-fns

### Database and Backend
- Drizzle ORM
- Neon Database
- Express.js
- Connect-pg-simple

### Development Tools
- Vite
- TypeScript
- ESBuild

### Integrations
- Google Sheets API