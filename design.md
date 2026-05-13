# Clever Driver App UI Design Prompt

## 0. Global Design Direction

Create a modern, premium mobile UI design system for a Canadian delivery-driver route management app named **Clever Driver**.

The app should feel operational, reliable, clean, and driver-friendly.
The interface must prioritize clarity, fast scanning, and confident action-taking while driving or handling deliveries.

Do not use photographic images.
Do not use decorative illustrations.
Do not use icons.
Use only typography, cards, buttons, status chips, dividers, progress bars, input fields, map shapes, markers, and layout hierarchy.

All UI text should be in English.
All dynamic values should be treated as server-provided data.
Do not hardcode sample company names, addresses, dates, times, route values, or delivery counts.

---

## 1. Design System

### 1.1 Visual Style

Use a clean logistics-tech aesthetic.

The interface should use:

- White and very light neutral backgrounds
- Rounded content cards
- Soft shadows
- Thin borders
- Clear vertical rhythm
- Large touch-friendly buttons
- Minimal visual noise
- Calm blue and green accents
- High readability for mobile usage

The design should look like a production-ready iOS-style mobile app, not a concept sketch.

---

### 1.2 Color System

Use a restrained color palette.

```md
Primary Action Color:

- Strong blue
- Used for main CTAs, selected tabs, active route states, current progress, focused elements

Success / Active Tracking Color:

- Green
- Used for GPS active state, completed status, successful delivery, proof submitted, route completion

Background:

- Off-white or very light gray
- Used for page background

Surface:

- Pure white or near-white
- Used for cards, sheets, forms, route summaries, list containers

Text Primary:

- Near-black
- Used for page titles, section titles, important data values

Text Secondary:

- Muted gray
- Used for labels, descriptions, helper text, metadata

Border:

- Light gray
- Used for inputs, cards, separators, inactive controls

Disabled / Inactive:

- Soft gray
- Used for inactive tabs, unavailable states, placeholder text
```

Avoid overly saturated backgrounds.
Color should guide the driver’s attention, not decorate the page.

---

### 1.3 Typography

Use a modern sans-serif UI font.

Typography hierarchy:

```md
Page Title:

- Large
- Bold
- High contrast

Section Title:

- Medium size
- Semibold
- Used above grouped content

Primary Data Value:

- Medium to large
- Semibold or bold
- Used for key server-driven values

Label:

- Small to medium
- Medium weight
- Muted color

Helper Text:

- Small
- Regular weight
- Muted gray

Button Text:

- Medium
- Semibold
- Center aligned
```

Text should be concise and easy to scan.
Avoid long paragraphs inside mobile screens.
Dynamic server values should truncate gracefully when too long.

---

### 1.4 Spacing

Use consistent spacing throughout the app.

```md
Screen horizontal padding:

- 20px to 24px

Vertical section spacing:

- 20px to 28px

Card internal padding:

- 16px to 20px

Button height:

- 52px to 56px

Small form field height:

- 48px to 52px

Large text area height:

- 96px to 128px

Gap between list rows:

- 10px to 14px

Gap between grouped sections:

- 24px to 32px
```

The design should feel airy but not sparse.
Every screen should be optimized for one-handed mobile use.

---

### 1.5 Corners, Borders, and Shadows

```md
Card radius:

- 16px to 20px

Input radius:

- 12px to 14px

Button radius:

- 12px to 16px

Status chip radius:

- Fully rounded pill

Border:

- 1px solid light gray

Selected border:

- 1.5px to 2px primary blue

Shadow:

- Very soft
- Low opacity
- Used only for cards and floating panels
```

Avoid heavy shadows.
Depth should be subtle and functional.

---

### 1.6 Button System

Use clear primary and secondary button styles.

```md
Primary Button:

- Filled blue
- White label
- Full width when it is the main page action
- Used for progressing the delivery flow

Success Button:

- Filled green or blue depending on hierarchy
- Used for completion-related actions

Secondary Button:

- White background
- Blue border
- Blue label
- Used for alternate actions

Text Button:

- Blue label only
- Used sparingly
```

Primary CTA should always be visually dominant.
Each screen should have one clear next action.

---

### 1.7 Form System

Use clean rounded form fields.

```md
Text Input:

- White surface
- Light gray border
- Clear label above field
- Placeholder text in muted gray
- Server value displayed in primary text

Select Field:

- Same style as text input
- Label above
- Selected server value or placeholder
- No icon required

Checkbox / Consent Control:

- Square selection box
- Text label beside it
- Linked terms styled with blue text

Text Area:

- Larger rounded input area
- Used for notes or delivery details
```

Do not use example values inside fields.
Use empty, placeholder, or bound-data states only.

---

### 1.8 Status Chips

Use pill-shaped chips for states.

```md
Active:

- Light green background
- Green text

Selected:

- Blue background
- White text

Pending:

- Light gray background
- Gray text

Completed:

- Light green background
- Green text

Warning / Issue:

- Light amber or light red background
- Dark warning text
```

Status chips should be compact and readable.

---

### 1.9 Data Binding Rule

Do not include example data values in the design.

Every dynamic value should be treated as a server-provided variable.

Use content areas that can display:

```md
{driverName}
{phoneNumber}
{verificationCode}
{routeStatus}
{companyName}
{routeDate}
{regionName}
{routeSequence}
{stopCount}
{estimatedDistance}
{estimatedDuration}
{depotName}
{stopNumber}
{stopAddress}
{stopCity}
{stopProvince}
{stopPostalCode}
{eta}
{completedTime}
{distanceRemaining}
{gpsStatus}
{deliveryInstructions}
{locationTips}
{deliveryNoteOptions}
{selectedDeliveryNote}
{selectedLocationTip}
{additionalNotes}
{proofRequiredItems}
{proofStatus}
{routeProgress}
{completedStopCount}
{totalStopCount}
```

Use variable placeholders only in documentation.
In the visual mockup itself, values may appear as neutral skeleton/data placeholders if needed.

---

# Image Set 1: Core Driver Flow

This image should contain four mobile screens arranged side-by-side.

Screens:

```md
1. Login / Driver Verification
2. Today’s Route
3. Route Details
4. Live Tracking
```

All four screens must share the same design language, spacing, card style, typography, and color system.

---

## Screen 1: Login / Driver Verification

### Purpose

Allow the driver to enter verification information and agree to required policies before using the app.

---

### Layout Structure

```md
Top Area:

- App logo text or app name
- Short product tagline
- Clean open space
- Optional subtle abstract background pattern
- No image
- No icon

Main Form Area:

- Phone number field
- Verification code field
- Full name field
- Consent controls
- Primary CTA

Bottom Area:

- Primary action button
- Safe-area spacing
```

---

### Components

#### App Brand Area

```md
Component:

- App name text

Content:

- App name should be displayed prominently.
- Tagline should be displayed below the app name.
- Keep the brand area centered.
- Do not include decorative imagery.
- Do not include icons.
```

#### Phone Number Field

```md
Component:

- Labeled input field

Behavior:

- Accepts server or user-provided phone number
- Should support Canadian phone number formatting
- Should not contain hardcoded example number

Visual:

- Rounded input
- White surface
- Light border
- Label above input
```

#### Verification Code Field

```md
Component:

- Labeled input field
- Inline secondary action text/button for sending code

Behavior:

- Accepts verification code
- Secondary action triggers verification code request
- No hardcoded code or timer value

Visual:

- Rounded input
- Inline action aligned to the right
- Action label in primary blue
```

#### Full Name Field

```md
Component:

- Labeled input field

Behavior:

- Accepts driver name
- Value comes from user input or server profile state

Visual:

- Rounded input
- White surface
- Light border
```

#### Consent Section

```md
Component:

- Two consent rows

Rows:

- Privacy policy consent
- Location-based services consent

Behavior:

- Each row has selectable state
- Linked policy text should be visually distinct
- Required consent rows should be clear

Visual:

- Left-aligned checkbox
- Text label beside checkbox
- Blue link text for policy-related label portion
- No icons
```

#### Primary CTA

```md
Component:

- Full-width primary button

Label:

- Continue

Visual:

- Filled blue background
- White semibold text
- Rounded corners
- Fixed touch-friendly height
```

---

### Design Notes

```md
- Screen should feel simple and trustworthy.
- Prioritize form clarity.
- Do not make the login screen feel like a marketing landing page.
- Keep the visual hierarchy focused on verification and consent.
- Avoid dense legal text.
```

---

## Screen 2: Today’s Route

### Purpose

Show the driver one assigned route for the day and allow them to start it.

---

### Layout Structure

```md
Top Area:

- Page title
- Optional short greeting or helper line
- Optional notification/action area without icon

Status Tabs:

- Pending
- In Progress
- Completed

Main Content:

- Single assigned route card only
- Route summary fields
- Main start action

Bottom Navigation:

- Text-based navigation labels
- No icons
```

---

### Components

#### Header

```md
Component:

- Page title
- Short helper text

Behavior:

- Page title remains static
- Helper text may use server-provided driver context if available

Visual:

- Left-aligned
- Strong title weight
- Muted helper text
```

#### Route Status Tabs

```md
Component:

- Segmented control

Tabs:

- Pending
- In Progress
- Completed

Behavior:

- Shows selected route status
- Selected tab uses filled blue style
- Inactive tabs use neutral style

Visual:

- Rounded segmented control
- Equal-width tab items
- Clear selected state
```

#### Assigned Route Card

```md
Component:

- Large route summary card

Content Areas:

- Company name
- Route date
- Region
- Route sequence
- Stop count
- Estimated distance
- Estimated duration

Behavior:

- Only one route should be displayed
- All field values come from server
- Long values should truncate or wrap safely

Visual:

- White card
- Rounded corners
- Blue selected border
- Soft shadow
- Two-column label/value layout
- Labels muted
- Values primary text
```

#### Start Route Button

```md
Component:

- Full-width primary CTA inside or below the route card

Label:

- Start Route

Visual:

- Filled blue
- White text
- Rounded corners
- Large tap area
```

#### Bottom Navigation

```md
Component:

- Bottom navigation bar

Items:

- Home
- Routes
- Earnings
- Profile

Behavior:

- Current section selected
- Navigation labels only
- No icons

Visual:

- Fixed bottom area
- Selected label in blue
- Inactive labels in gray
```

---

### Design Notes

```md
- This screen must show exactly one assigned route.
- Do not use multiple route cards.
- The route card should be the visual focus.
- Keep the primary action obvious.
- Avoid adding unnecessary dashboard widgets.
```

---

## Screen 3: Route Details

### Purpose

Allow the driver to review the full route sequence before starting live tracking.

---

### Layout Structure

```md
Top Area:

- Back control as text or simple affordance
- Page title
- Optional overflow text control

Summary Card:

- Company name
- Route date
- Stop count
- Estimated distance
- Estimated duration

Timeline Area:

- Depot / pickup point
- Ordered stop list
- Current or next stop highlight
- ETA for each stop

Bottom Area:

- Primary CTA
```

---

### Components

#### Header

```md
Component:

- Page title
- Back affordance
- Optional menu affordance

Visual:

- Centered or left-aligned title
- Minimal header
- No icons
```

#### Route Summary Card

```md
Component:

- Compact summary card

Content Areas:

- Company name
- Date
- Stop count
- Estimated distance
- Estimated duration

Behavior:

- Values come from server
- Card should remain compact

Visual:

- White card
- Rounded corners
- Soft shadow
- Internal dividers may be used
- Data arranged in clean rows or grid
```

#### Stop Timeline

```md
Component:

- Vertical ordered stop list

Content Areas:

- Depot / pickup point
- Stop number
- Stop address
- ETA
- Stop state

States:

- Completed
- Current
- Upcoming
- Last

Behavior:

- Stop list is server-driven
- Current or next stop should be visually highlighted
- Long addresses should wrap to two lines maximum
- Timeline should support variable stop count

Visual:

- Vertical line or structured list spacing
- Current stop uses blue highlight background
- Completed state uses green accent
- Upcoming state uses neutral style
- Last stop uses distinct neutral label
- No icons
```

#### Begin Tracking Button

```md
Component:

- Full-width primary CTA

Label:

- Begin Tracking

Visual:

- Filled blue
- White text
- Rounded corners
- Bottom aligned
```

---

### Design Notes

```md
- The screen should help the driver understand the whole delivery order.
- The current or next stop must be visually obvious.
- Use timeline spacing and highlight treatment instead of icons.
- Keep the route summary separate from the stop list.
```

---

## Screen 4: Live Tracking

### Purpose

Show the driver’s current GPS position and route overview on a general map, not a turn-by-turn navigation screen.

---

### Layout Structure

```md
Top Area:

- Page title
- GPS tracking status pill

Map Area:

- General city map surface
- Current user GPS marker
- Route overview line
- Stop markers
- No turn-by-turn instruction UI

Bottom Sheet:

- Next stop summary
- Distance remaining
- ETA
- Tracking status
- Primary and secondary actions
```

---

### Components

#### Header

```md
Component:

- Page title
- Back affordance
- Optional menu affordance

Visual:

- Simple and compact
- No icons
```

#### GPS Status Pill

```md
Component:

- Status pill

Content:

- GPS tracking active/inactive state

Behavior:

- State comes from location tracking system
- Active state uses green treatment
- Inactive or error state can use warning treatment

Visual:

- Floating pill over map or placed below header
- Rounded
- Light surface
- Green active indicator using text or small non-icon dot shape
```

#### Map Area

```md
Component:

- General map-style panel

Content:

- Current driver location
- Route overview path
- Stop markers
- Destination markers

Behavior:

- Map is a general tracking view
- Show driver’s live GPS position
- Show route context
- Do not show driving instructions
- Do not show turn arrows
- Do not show lane guidance
- Do not show next-turn banner

Visual:

- Light map background
- Pale roads and area blocks
- Route line in blue
- Current GPS location shown with circular pulse/ring
- Stop markers shown as numbered circles or labeled pills
- Use shapes and text labels only
- No icons
```

#### Bottom Tracking Sheet

```md
Component:

- Floating bottom sheet

Content Areas:

- Next stop label
- Next stop address
- Distance remaining
- ETA
- Status

Behavior:

- Values come from server and GPS system
- Sheet should remain readable over map
- Long address should wrap gracefully

Visual:

- White rounded panel
- Top drag handle optional
- Light shadow
- Data arranged in compact columns
```

#### Action Buttons

```md
Component:

- Two-button row

Buttons:

- Secondary action: View Stop
- Primary action: Arrived

Visual:

- Secondary button outlined blue
- Primary button filled blue
- Equal height
- Primary action visually stronger
```

---

### Design Notes

```md
- This screen must not look like turn-by-turn navigation.
- It should feel like GPS tracking and route overview.
- Map should be calm and uncluttered.
- The bottom sheet should provide the operational context.
```

---

# Image Set 2: Stop Handling and Completion Flow

This image should contain four mobile screens arranged side-by-side.

Screens:

```md
1. Stop Details
2. Arrival Check
3. Stop Completed
4. Completed Deliveries
```

These screens should continue the exact same design system as Image Set 1.

---

## Screen 5: Stop Details

### Purpose

Show all relevant information about the current delivery stop before arrival.

---

### Layout Structure

```md
Top Area:

- Page title
- Back affordance
- Optional menu affordance

Stop Summary Card:

- Stop number
- Address
- Recipient/company/building name

Instruction Sections:

- Delivery instructions
- Location tips

Contact Actions:

- Call
- Message

Bottom Actions:

- Primary action
- Secondary action
```

---

### Components

#### Header

```md
Component:

- Page title
- Back affordance
- Optional menu affordance

Visual:

- Compact top bar
- No icons
```

#### Stop Summary Card

```md
Component:

- Main stop information card

Content Areas:

- Stop number
- Address line
- City/province/postal code
- Recipient name or location name

Behavior:

- All values come from server
- Stop number should be visually prominent
- Address should support multiple lines

Visual:

- White rounded card
- Light border
- Stop number in blue circular or pill shape
- Address grouped clearly under stop title
```

#### Delivery Instructions Section

```md
Component:

- Section title
- Text content card

Behavior:

- Displays server-provided delivery instructions
- Empty state should be supported

Visual:

- Section title in semibold
- Instruction text inside light surface card
- Text should be readable and not compressed
```

#### Location Tips Section

```md
Component:

- Section title
- Text content card

Behavior:

- Displays server-provided location tips
- Empty state should be supported

Visual:

- Same style as delivery instructions
- Light card with rounded corners
```

#### Contact Actions

```md
Component:

- Two secondary action buttons

Buttons:

- Call
- Message

Behavior:

- Trigger contact actions
- Disabled state should be available if contact data is missing

Visual:

- Outlined buttons
- Blue label
- Equal width
- No icons
```

#### Arrival Actions

```md
Component:

- Primary and secondary stacked buttons

Buttons:

- Arrived
- I’m Nearby

Visual:

- Primary button filled blue
- Secondary button outlined blue
- Full width
- Large tap area
```

---

### Design Notes

```md
- This screen is for quick pre-arrival reading.
- The address and delivery instructions should be easiest to scan.
- Avoid visual clutter.
- Do not overload this screen with route progress.
```

---

## Screen 6: Arrival Check

### Purpose

Allow the driver to complete arrival handling, photo proof requirements, delivery notes, location tips, and final stop submission.

---

### Layout Structure

```md
Top Area:

- Page title
- Back affordance
- Optional menu affordance

Arrival Status:

- Nearby destination banner
- Voice tip availability status

Proof Section:

- Required proof upload tiles

Delivery Notes Section:

- Issue selection field

Location Tip Section:

- Tip selection field

Additional Notes:

- Text area

Bottom Area:

- Complete stop CTA
```

---

### Components

#### Header

```md
Component:

- Page title

Visual:

- Compact
- No icons
```

#### Arrival Status Banner

```md
Component:

- Status banner

Content Areas:

- Nearby destination status
- Voice tip availability text

Behavior:

- Status comes from location proximity system
- Voice tip state comes from server or local data

Visual:

- Light green background
- Green border or accent
- Rounded card
- Text-only status treatment
- No icons
```

#### Photo Proof Section

```md
Component:

- Section title
- Proof upload tile group

Behavior:

- Tile list is server-driven
- Each tile represents a required proof category
- Each tile supports empty, uploaded, failed, and optional states
- No actual photo previews should appear in the mockup
- Use placeholder upload cards only

Visual:

- Dashed border tiles
- White or very light surface
- Rounded corners
- Centered text labels
- No icons
```

#### Today’s Delivery Notes Select

```md
Component:

- Labeled select field

Behavior:

- Options come from server
- Selected value comes from user input
- Empty state should show placeholder text

Visual:

- Rounded field
- Light border
- White surface
- No icon required
```

#### Location Tip Select

```md
Component:

- Labeled select field

Behavior:

- Options come from server
- Selected value comes from user input
- Should support adding or selecting a tip

Visual:

- Same style as select field above
```

#### Additional Notes Text Area

```md
Component:

- Labeled multiline input

Behavior:

- Accepts optional driver notes
- Empty state should be visually clear
- Should support longer text

Visual:

- Rounded text area
- Light border
- Muted placeholder
```

#### Complete Stop Button

```md
Component:

- Full-width primary CTA

Label:

- Complete Stop

Visual:

- Filled blue or green
- White text
- Rounded corners
- Bottom aligned
```

---

### Design Notes

```md
- This screen is operational and form-heavy.
- Maintain generous spacing so it does not feel crowded.
- Proof upload tiles should be clearly separated from notes.
- Avoid using real photos or sample proof images.
- Avoid icons.
```

---

## Screen 7: Stop Completed

### Purpose

Confirm that one stop has been completed and guide the driver to the next step.

---

### Layout Structure

```md
Top Area:

- Page title
- Back affordance
- Optional menu affordance

Success Area:

- Large success indicator using shape and color
- Completion message

Completion Summary:

- Completed time
- Route progress count

Next Stop Card:

- Next stop address
- Progress bar

Bottom Actions:

- Continue to next stop
- Back to route
```

---

### Components

#### Header

```md
Component:

- Page title

Visual:

- Compact top bar
- No icons
```

#### Success Indicator

```md
Component:

- Large circular success shape

Behavior:

- Indicates completed state

Visual:

- Large green circle or rounded success badge
- Checkmark may be replaced with text-only confirmation if icons are strictly prohibited
- No decorative illustration
```

#### Completion Message

```md
Component:

- Confirmation headline

Content:

- Completion message should reference current stop dynamically

Behavior:

- Stop number and status come from server

Visual:

- Center aligned
- Bold
- High contrast
```

#### Completion Summary Card

```md
Component:

- Two-row summary card

Rows:

- Completed time
- Route progress

Behavior:

- Values come from server
- Should support delayed sync or pending upload states

Visual:

- White card
- Rounded corners
- Light border
- Row labels left
- Values right
```

#### Next Stop Card

```md
Component:

- Next stop preview card

Content Areas:

- Next stop label
- Next stop address
- Route progress bar

Behavior:

- If there is no next stop, show route completion state
- Address comes from server
- Progress is calculated from completed and total stops

Visual:

- White card
- Rounded corners
- Progress bar with green fill
- Muted percentage text
```

#### Bottom Actions

```md
Component:

- Primary and secondary stacked buttons

Buttons:

- Continue to Next Stop
- Back to Route

Visual:

- Primary filled blue
- Secondary outlined blue
- Full width
```

---

### Design Notes

```md
- This screen should feel reassuring and conclusive.
- The driver should instantly understand the stop is complete.
- The next step should be obvious.
- Avoid celebratory graphics.
```

---

## Screen 8: Completed Deliveries

### Purpose

Show the driver a summary and list of completed deliveries for the selected route or day.

---

### Layout Structure

```md
Top Area:

- Page title
- Date or route filter control

Summary Card:

- Completed stop count
- Proof submission status

Filter Tabs:

- All
- With Issues
- Proof Missing

Completed Stop List:

- Stop rows
- Address
- Completed time
- Proof status
- Detail affordance

Bottom Area:

- Optional safe spacing
```

---

### Components

#### Header

```md
Component:

- Page title
- Date filter or route filter control

Behavior:

- Date and route filter values come from server or user selection
- Must support changing selected date/route

Visual:

- Clean top layout
- No icons
```

#### Completion Summary Card

```md
Component:

- Route/day completion summary

Content Areas:

- Completed count
- Total stop count
- Proof records status

Behavior:

- Values come from server
- Should support full completion, partial completion, issue state, and missing proof state

Visual:

- Light green background when complete
- Neutral or warning background when incomplete
- Rounded card
- Strong summary text
```

#### Filter Tabs

```md
Component:

- Horizontal pill filter control

Tabs:

- All
- With Issues
- Proof Missing

Behavior:

- Counts come from server
- Selected tab filters the list

Visual:

- Selected tab filled blue
- Inactive tabs white or light gray
- Pill shape
- Compact spacing
```

#### Completed Stop List

```md
Component:

- Vertical list of completed stops

Each Row Content:

- Stop label
- Address
- Completed time
- Proof status
- Optional issue status
- Detail affordance

Behavior:

- Rows come from server
- Support variable row count
- Support missing proof state
- Support issue state
- Support completed state
- Row tap opens stop detail

Visual:

- White list container or individual white cards
- Light dividers
- Rounded outer container
- Green status label for proof uploaded
- Warning label for missing proof or issue
- No icons
```

---

### Design Notes

```md
- This screen should feel like an operational record.
- Prioritize clear status visibility.
- Avoid making the list too visually heavy.
- Each row should be scannable in less than one second.
```

---

# Data and Content Rules

## Do Not Include Example Values

The UI must not contain hardcoded examples such as:

```md
- Specific company names
- Specific driver names
- Specific addresses
- Specific dates
- Specific times
- Specific phone numbers
- Specific route distances
- Specific region names
- Specific stop counts
```

All of these must be treated as dynamic server data.

---

## Use Dynamic Data Regions

Instead of sample content, design screens with data regions such as:

```md
Company Name Area
Route Date Area
Region Area
Route Sequence Area
Stop Count Area
ETA Area
Distance Area
Address Area
Delivery Instructions Area
Location Tip Area
Proof Requirement Area
Completion Status Area
```

The layout must remain stable whether values are short, long, empty, pending, or loading.

---

## Empty State Support

Each relevant screen should support empty or unavailable states.

```md
No assigned route
GPS unavailable
Location permission missing
No delivery instructions
No location tips
No proof required
Proof upload pending
Server sync pending
No completed deliveries
```

Empty states should use text, spacing, neutral cards, and clear action buttons.
Do not use icons or illustrations.

---

## Loading State Support

Use skeleton loaders or neutral placeholder blocks for server-loaded content.

```md
- Route card skeleton
- Stop list skeleton
- Map loading surface
- Proof tile loading state
- Completed delivery list skeleton
```

Loading states should preserve layout structure to avoid visual jump.

---

## Error State Support

Use clear text-based error states.

```md
- Verification failed
- Route not found
- GPS tracking unavailable
- Proof upload failed
- Completion sync failed
```

Error states should use a restrained warning color and provide one clear next action.

---

# Final Output Requirement

Create two separate mockup images.

```md
Image 1:

- Login / Driver Verification
- Today’s Route
- Route Details
- Live Tracking

Image 2:

- Stop Details
- Arrival Check
- Stop Completed
- Completed Deliveries
```

Both images must:

```md
- Show four mobile screens side-by-side
- Use the same device frame style
- Use the same spacing system
- Use the same color system
- Use the same typography
- Use English UI text
- Avoid hardcoded sample data
- Avoid icons
- Avoid photos
- Avoid decorative objects
- Avoid captions outside the devices
- Feel like one unified production app
```
