# Design Guidelines: Radio Dialog Automation System

## Design Approach
**System-Based Approach**: Material Design principles adapted for productivity tools
**Rationale**: This is a utility-focused application for radio content management requiring clear information hierarchy, efficient workflows, and reliable interaction patterns.

## Core Layout Structure

### Dashboard View
- **Primary Layout**: Sidebar navigation (240px width) with main content area
- **Sidebar**: Fixed position, contains navigation items: Dashboard, Dialog Generator, Schedule, Files, Settings
- **Content Area**: Maximum width container (max-w-7xl) with consistent padding

### Key Sections
1. **Generation Interface**: Two-column layout on desktop
   - Left: AI prompt editor (rich text area, 400px min-height)
   - Right: Generation controls and preview
2. **Schedule Calendar**: Full-width calendar grid showing 12 daily segments
3. **File Browser**: Table-based list view with folder hierarchy navigation
4. **Settings Panel**: Single column form layout (max-w-2xl)

## Typography System
- **Primary Font**: Inter (via Google Fonts CDN)
- **Hierarchy**:
  - Page Headers: text-3xl font-bold
  - Section Headers: text-xl font-semibold
  - Body Text: text-base
  - Labels/Meta: text-sm font-medium
  - Captions: text-xs

## Spacing Primitives
**Standardized Tailwind Units**: 2, 4, 6, 8, 12, 16, 24
- Component padding: p-6
- Section spacing: mb-8, mt-12
- Card spacing: p-8
- Button padding: px-6 py-3
- Form fields: mb-6

## Component Library

### Navigation
- **Sidebar Items**: Vertical list with icons (Heroicons), hover state with subtle background
- **Active State**: Border-left accent indicator (4px width)

### Forms & Inputs
- **Text Inputs**: Full border, rounded-lg, focus ring
- **Text Areas**: Same styling, minimum height of 6 rows
- **Selects**: Custom styled dropdowns with chevron icons
- **Number Inputs**: Compact width (w-32) with stepper controls
- **All form fields**: Consistent label positioning (above input), helper text below

### Buttons
- **Primary**: Solid fill, rounded-lg, medium shadow
- **Secondary**: Outline style with border-2
- **Icon Buttons**: Square (44px × 44px), rounded-full for actions
- **Sizes**: Small (px-4 py-2), Medium (px-6 py-3), Large (px-8 py-4)

### Cards
- **Container**: Rounded-xl with subtle shadow (shadow-sm)
- **Padding**: p-8
- **Header**: Includes title and optional action button
- **Sections**: Divide with horizontal border when needed

### Tables
- **Structure**: Full-width with sticky header
- **Rows**: Hover state, alternating subtle background on rows
- **Cells**: Consistent padding (px-6 py-4)
- **Actions Column**: Right-aligned icon buttons

### Status Indicators
- **Pills/Badges**: Rounded-full, px-3 py-1, text-sm
- **States**: Generated, Uploading, Ready, Error
- **Icons**: Use Heroicons for status visualization

### Dialog Generator Interface
- **Prompt Editor**: Rich text area with formatting toolbar (bold, italic, bullet points)
- **Voice Selection**: Dropdown selectors for male/female voices (ElevenLabs voices)
- **Topic Suggestions**: Chip-style buttons for quick topic insertion
- **Preview Player**: Compact audio player with waveform visualization
- **Generate Button**: Prominent, full-width on mobile, right-aligned on desktop

### Calendar/Schedule View
- **Grid Layout**: 7-column week view
- **Time Slots**: 12 segments per day displayed as cards
- **Segment Cards**: Mini cards showing time, status, file link
- **Empty States**: Dashed border placeholder for ungenerated segments

### File Browser
- **Breadcrumb Navigation**: Year > Month > Day structure at top
- **File List**: Table with columns: Name, Duration, Size, Status, Actions
- **Upload Status**: Progress bars for active uploads
- **Actions**: Download, Preview (play), Delete icons

### Settings Panel
- **Sections**: Grouped with section headers
- **API Configuration**: Masked input for API keys with show/hide toggle
- **Daily Segments**: Number input with clear label "Количество подводок в день"
- **Yandex Disk**: Connection status indicator + folder path input

## Layout Specifications

### Responsive Breakpoints
- Mobile: Single column, stacked layout, collapsed sidebar (drawer)
- Tablet (md:): Two-column where appropriate
- Desktop (lg:): Full multi-column layout with visible sidebar

### Page Structure
```
[Sidebar | Main Content Area]
         [Page Header with Title + Actions]
         [Content Sections with Cards]
```

## Accessibility
- All interactive elements minimum 44px touch target
- Focus indicators on all focusable elements
- Proper label associations for form inputs
- Skip navigation link
- ARIA labels for icon-only buttons
- Keyboard navigation support throughout

## Animation Strategy
**Minimal Animations**: Only for feedback and transitions
- Sidebar slide-in/out: 200ms ease
- Button hover: Subtle scale (scale-105)
- Loading states: Simple spinner
- No scroll-based or decorative animations

## Icons
**Icon Library**: Heroicons (via CDN)
**Usage**: 
- Navigation: 24px icons
- Buttons: 20px icons
- Table actions: 16px icons
- Status indicators: 16px icons

## Images
**No hero images needed** - This is a utility application focused on functionality rather than visual branding. The interface should be clean and content-focused without decorative imagery.