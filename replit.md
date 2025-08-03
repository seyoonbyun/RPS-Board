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

### Key Features
- **Progress Tracking**: Visual achievement ring showing completion percentage toward 4-partner goal
- **Partner Management**: Form-based interface for managing up to 4 referral partners
- **Stage Tracking**: V (Visitor), C (Contact), P (Partner) stage progression
- **Automatic Google Sheets Sync**: Data automatically syncs to Google Sheets upon saving, no manual sync required
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