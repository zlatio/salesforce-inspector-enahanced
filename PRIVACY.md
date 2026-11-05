# Privacy policy

*Salesforce Inspector Enhanced, effective 5 November 2026*

Salesforce Inspector Enhanced is a browser extension that lets Salesforce admins and developers inspect and edit records, run SOQL queries, import data, manage users and monitor org limits. This page explains what the extension reads, where that data goes, and what it keeps.

**In short:** the extension talks only to the Salesforce org you're logged into. It has no server of its own, no analytics, no ads and no tracking. The developer never receives any of your data.

## What the extension reads

- **Your Salesforce session cookie** (`sid`) for the org open in the current tab. The extension uses it as the access token for Salesforce API requests to that same org, so it works with your existing login. The cookie is read when needed and kept in memory only. It is never saved by the extension or sent anywhere other than that org.
- **The address and title of Salesforce pages** you have open, so the extension can tell which org, object or record you're looking at.
- **Data and metadata from your Salesforce org**, such as records, fields, users, permission sets, debug logs and limits. These come straight from your org's Salesforce APIs when you use a feature that needs them, and are shown to you in the extension.

The extension only runs on Salesforce domains (for example `*.salesforce.com`, `*.force.com` and `*.visualforce.com`). It can't see other websites.

## Where your data goes

- Requests go **only to your own Salesforce org**, over HTTPS. This includes the changes you make: record edits, imports, deletes, freezing users and turning on debug logs.
- Nothing is sent to the developer or to any third party. The extension doesn't load remote code; all of its code, styles and fonts are inside the package.
- Exports (CSV, JSON, debug logs, import results) are saved to your computer only when you choose to download them.

## What is stored on your device

The extension stores the following in your browser's extension storage. It stays on your device, isn't synced, and is removed when you uninstall the extension.

| What | Why |
|---|---|
| Theme and display preferences (toolbar action, in-page button and its position, grid time zone, panel sizes, filters) | To keep your settings |
| SOQL query tabs, query history (query text, object, row count, time) and saved queries | So you can return to your queries. Query results aren't stored. |
| Recently used orgs (host name, org name, sandbox or production) | For the org switcher |
| Recently opened objects and records (object name, record ID and record name) | For the command palette |
| API usage samples and limit snapshots (numbers only) | To show usage trends on the Limits page |
| Unsaved edits in an open Inspector tab | So switching pages doesn't lose them. They are cleared when the tab is closed. |

You can clear query history from the Query page, and remove everything by uninstalling the extension.

## Permissions

| Permission | Why it's needed |
|---|---|
| `cookies` | Read the Salesforce session cookie described above, and notice when you log in again so the side panel reconnects |
| `storage` | Keep the settings and history listed above on your device |
| `sidePanel` | Show the Inspector side panel next to Salesforce pages |
| Access to Salesforce domains | Call your org's Salesforce APIs, and run the small script that detects the current record and shows the optional in-page button |

## Changes and contact

If this policy changes, the new version will be published at this address with a new effective date. Questions or concerns: [open an issue on GitHub](https://github.com/zlatio/salesforce-inspector-enhanced/issues).

Salesforce Inspector Enhanced is an independent project. It isn't affiliated with, endorsed by or sponsored by Salesforce, Inc. Salesforce is a trademark of Salesforce, Inc.
