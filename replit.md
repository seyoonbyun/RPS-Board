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
- **Authorization System**: ✅ IMPLEMENTED (Aug 6, 2025)
  - Google Sheets AUTH column (24th column) integration for role-based access control
  - Admin roles: "Admin" and "Growth" 
  - Dynamic permission checking API: `/api/admin/check-permission`
  - Frontend UI conditionally displays admin features based on user permissions
  - Secure admin panel access with automatic redirect for unauthorized users
- **User Management System**: ✅ UPDATED (Aug 6, 2025)
  - Single user addition with profile data (email, region, chapter, member name, specialty, password)
  - CSV file upload for bulk user addition with comprehensive error handling and encoding support
  - UTF-8/EUC-KR encoding detection and proper Korean text handling
  - Header row detection and automatic skipping for CSV files
  - Real-time Google Sheets integration for immediate data persistence
  - Automatic validation for required fields (email, member name)
  - Smart row allocation system that reuses empty rows from deleted users
  - Streamlined admin panel UI with CSV file upload only (text input method removed)
  - Full integration with existing withdrawal and permission systems
  - **Target Customer Policy**: Target customer (나의 핵심 고객층) excluded from admin addition - users manage this field directly

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
- **Login Page Enhancement**: ✅ UPDATED (Aug 3, 2025)
  - Footer message updated from generic signup text to BNI Connect email clarification
  - Toast notification styling enhanced with proper white background and 3-second duration
  - All popup notifications (login, logout, save) use consistent styling and timing
  - Login card styling enhanced with brand color border (1px #d12031) and 3D shadow effects
  - Login failure message customized to "잠깐 !" with friendly guidance text
- **Print Layout Enhancement**: ✅ UPDATED (Aug 4, 2025)
  - Page title changed from "RPS Board - Replit" to "BNI Korea 파워팀 R파트너 스코어보드"
  - HTML language attribute updated to Korean (lang="ko")
  - Print CSS added to remove browser headers/footers during printing
  - Clean A4 print layout with proper margins and white background
  - Replit development banners hidden during print operations
  - Toast notifications and popup dialogs hidden during print to prevent inclusion in printed documents
  - Custom footer URL "https://www.powerteam-bnikorea.com" added for print layout
  - Enhanced @page CSS rules to override browser default headers and footers
  - Print header added with "BNI Korea My Powerteam RPS Report" title and current timestamp (yyyy-mm-dd, hh:mm:ss format)
- **Data Integrity Control**: ✅ IMPLEMENTED (Aug 3, 2025)
  - Google Sheets sourced fields (지역, 챕터, 멤버, 업태명, 타겟고객) converted to read-only
  - Visual indicators added: gray background, disabled cursor, "(구분 시트 연동)" labels
  - User can only modify R파트너 information while viewing authentic Google Sheets data
  - Prevents data corruption between local changes and Google Sheets synchronization
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
  - ✅ DYNAMIC USER MANAGEMENT (Aug 4, 2025): Robust handling of user additions/deletions
    - Automatic detection of new users in Google Sheets (up to 5000 rows)
    - Smart row reallocation: Empty rows from deleted users are recycled for new users
    - Enhanced error handling for sheet limit exceeded scenarios
    - Improved authentication with dynamic ID/PW column detection
    - Safe bidirectional sync with no data loss during user changes
    - Real-time achievement rate updates for all user modifications
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