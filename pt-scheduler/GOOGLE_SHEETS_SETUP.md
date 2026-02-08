# Google Sheets Setup

## 1) Create the sheet

1. Open Google Sheets and create a new spreadsheet.
2. Rename the first tab to `Patients`.
3. Add this header row in row 1:

`id,fullName,nicknames,phone,alternateContacts,address,lat,lng,status,notes`

4. Add one patient per row.

## 2) Column format

- `id`: stable unique ID (example: `patient-001`)
- `fullName`: required (example: `Doe, Jane`)
- `nicknames`: comma-separated values (example: `Jane, Janie`)
- `phone`: string
- `alternateContacts`: semicolon-separated contacts using `Name|Phone|Relationship`
  - example: `Mary|555-111-2222|Daughter; John|555-333-4444|Spouse`
  - relationship is optional: `John|555-333-4444`
- `address`: full address string
- `lat`: optional decimal latitude
- `lng`: optional decimal longitude
- `status`: `active`, `discharged`, or `evaluation`
- `notes`: optional

## 3) Connect in app

1. Go to `Settings` in PT Scheduler.
2. Click `Sign In with Google`.
3. Paste Spreadsheet ID or full Sheet URL into `Spreadsheet ID`.
4. Click `Save Settings`.
5. Click `Import Patients Now`.

## 4) Spreadsheet ID example

From URL:

`https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit#gid=0`

Spreadsheet ID is:

`1AbCdEfGhIjKlMnOpQrStUvWxYz`
