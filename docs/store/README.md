# Chrome Web Store kit

Everything the Chrome Web Store developer dashboard asks for, in the order it asks. Copy each block into the matching field.

## 1. Package

Run `npm run package` and upload `salesforce-inspector-enhanced-<version>.zip` (Build → Package → Upload new package). The store reads the name, summary, icon and version from the manifest inside the zip. Each upload needs a higher `version` than the last one.

## 2. Store listing tab

**Title** (from the manifest): Salesforce Inspector Enhanced

**Summary** (from the manifest, 132 characters max):

```
Inspect and edit records, run and manage SOQL, and monitor org limits — with a modern light and dark UI.
```

**Description:**

```
A fast, modern toolkit for Salesforce admins and developers. Open it on any Salesforce page to inspect the record you're on, run SOQL, bulk edit data, import rows from a spreadsheet, look into users and keep an eye on org limits. It works with your existing Salesforce login: there's no connected app and nothing to configure.

RECORDS
• See every field of any record with its label, API name, type and value. Lookups show the related record's name.
• Edit inline with editors that fit each field type: picklists, dates and times, numbers, lookups and long text.
• Review every change before saving. The review re-reads the record and warns you if someone else changed it, and every save can be undone.
• Production orgs stay read-only until you turn editing on.
• Field details: formulas, help text, picklist values and the full describe, plus one click to query records with the same value.

SOQL
• Editor with autocomplete for objects, fields (by API name or label), relationships, picklist values and date literals.
• Query tabs, history per org and saved queries. Tooling API and "include deleted" are one switch away.
• Fast results grid with sorting, filtering and keyboard navigation. Copy rows straight into Excel, or export CSV or JSON.
• Bulk edit results in place, review what changed on the server, and save up to 200 records per call.

DATA IMPORT
• Paste from Excel or Google Sheets, or drop a CSV. Insert, update, upsert or delete.
• Columns map to fields automatically. Every row is checked before anything is sent, and rows with problems are listed first.

USERS
• Find users by name, username, email, profile or role. See their permission sets, groups, queues and login history.
• Log in as a user, freeze or unfreeze them, and turn on debug logs to read their Apex logs as they arrive.

ORG LIMITS
• Daily API requests, data and file storage and async Apex at a glance.
• One list of everything at 75% or more, including user and permission set licenses and licenses about to expire.
• Every limit grouped by category, with usage trends over time.

EVERYWHERE
• Toolbar popup that knows which record you're on (Alt+Shift+K).
• Side panel that stays open beside Salesforce and follows the active tab (Alt+Shift+S).
• Command palette (Ctrl/⌘+K) to jump to any object, field, recent record or saved query.
• Light and dark themes, full keyboard access and WCAG AA contrast.

PRIVACY
The extension talks only to the Salesforce org you're logged into. It has no server of its own, no analytics and no tracking, and it never sends your data to the developer or anyone else.

Open source (MIT): https://github.com/zlatio/salesforce-inspector-enhanced

Salesforce Inspector Enhanced is an independent project. It isn't affiliated with, endorsed by or sponsored by Salesforce, Inc. Salesforce is a trademark of Salesforce, Inc.
```

**Category:** Productivity → Developer Tools

**Language:** English

**Graphic assets** (all in this folder):

| Field | File | Size |
|---|---|---|
| Store icon | `icon-128.png` | 128×128 (96×96 artwork with transparent padding, as the store recommends) |
| Screenshots, in this order | `screenshots/1-record-light.png` … `screenshots/5-popup-sidepanel.png` | 1280×800 each |
| Small promo tile (required) | `promo-small.png` | 440×280 |
| Marquee promo tile (optional) | `promo-marquee.png` | 1400×560 |

The screenshots use a made-up demo org ("Acme") with invented people and companies, so no real org data is shown.

**Additional fields:**
- Homepage URL: `https://github.com/zlatio/salesforce-inspector-enhanced`
- Support URL: `https://github.com/zlatio/salesforce-inspector-enhanced/issues`
- Official URL: leave empty. It needs a site verified in Google Search Console.
- Mature content: No

## 3. Privacy tab

**Single purpose:**

```
A toolkit for working with the Salesforce org the user is logged into: inspect and edit its records, run SOQL queries, import data, manage users and monitor org limits.
```

**Permission justifications:**

`cookies`
```
Reads the Salesforce session cookie ("sid") of the org open in the current tab and uses it as the bearer token for REST API requests to that same org, so the extension works with the user's existing login without a connected app. It also listens for changes to that cookie so the side panel reconnects after the user logs in again. The cookie is kept in memory only and is never stored or sent anywhere other than the user's own org.
```

`storage`
```
Saves the user's preferences (theme, toolbar action, in-page button), SOQL query tabs, history and saved queries, recently used orgs and records, and API usage samples on the user's device.
```

`sidePanel`
```
Shows the Inspector side panel next to Salesforce pages. It lists the fields of the record in the active tab and links to the full inspector.
```

Host permissions
```
Limited to Salesforce domains (salesforce.com, force.com, visualforce.com, cloudforce.com, salesforce-setup.com and the Salesforce government and China domains). They are needed to call the Salesforce REST and Tooling APIs of the user's org, to read the session cookie for those hosts, and to run the content script that detects the current record and shows the optional in-page button. The extension does not run on any other site.
```

**Are you using remote code?** No, I am not using remote code.

```
All JavaScript, CSS and fonts are bundled in the package. The only network requests go to the Salesforce org the user is logged into, and they return data, not code.
```

**Data usage.** Tick these:
- **Personally identifiable information.** It shows user names, usernames and email addresses from the org (Users page, record owners) and keeps record names in the local recent-items list.
- **Authentication information.** It reads the Salesforce session cookie.
- **Website content.** It reads and edits Salesforce records and metadata.

Leave the rest unticked. Health, financial, communications, location, web history and user activity data are not collected.

**Certifications.** Tick all three:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** `https://github.com/zlatio/salesforce-inspector-enhanced/blob/master/PRIVACY.md`

## 4. Distribution tab

- **Payments:** Free
- **Visibility:**
  - **Public:** anyone can find it.
  - **Unlisted:** only people with the link.
  - **Private:** only named testers, Google Groups, or your Google Workspace domain.
  - All three get the same review.
- **Regions:** All regions

## 5. Test instructions tab (optional)

```
The extension needs a Salesforce login. Sign up for a free Developer Edition org at https://developer.salesforce.com/signup, log in, then open any Salesforce page and click the extension's toolbar icon (or press Alt+Shift+K). From the popup, "Inspect record" opens the current record, and "SOQL query" and "Org limits" open the other tools.
```

## Regenerating the images

- `npm run store:assets` re-renders `promo-small.png`, `promo-marquee.png`, `screenshots/5-popup-sidepanel.png` and `icon-128.png` from the HTML in `src/` (needs Chromium, ImageMagick and `rsvg-convert`).
- The screenshots were captured from the real extension against a fixture-backed demo org.
