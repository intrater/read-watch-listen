# RWL Capture — iOS Shortcut (assembly spec)

A share-sheet Shortcut that sends the page you're looking at — plus an optional
"why" note — to RWL's capture endpoint. Because Shortcuts can't be committed as
a file cleanly, you build it once from these steps. Takes ~5 minutes.

- **Endpoint:** `https://rwl-api.vercel.app/api/capture`
- **Auth:** `Authorization: Bearer <CAPTURE_TOKEN_IOS>` — Claude will copy this
  token to your clipboard when you reach the header step; paste it there.
- **Payload:** `{ "url": <shared URL>, "note": <your note>, "source": "ios-shortcut" }`

---

## Build it

1. Open the **Shortcuts** app → **+** (new shortcut) → name it **Save to RWL**.

2. **Shortcut settings → Share Sheet.** Tap the (i) / settings icon, turn on
   **Show in Share Sheet**, and under **Share Sheet Types** select **URLs**
   (and **Safari web pages**). This makes it appear in the share sheet.
   Set **Receive** to *Shortcut Input*; **If there's no input**, choose
   *Stop and respond* (or leave default).

3. Add action **Get URLs from Input**.
   - Set its input to the **Shortcut Input** variable.
   - (This pulls the actual link out of whatever was shared.)

4. Add action **Ask for Input**.
   - **Input type:** Text
   - **Prompt:** `Why this caught your eye? (optional)`
   - **Allow empty / default:** leave the default answer blank so you can just
     hit Done to skip the note.

5. Add action **Get Contents of URL**.
   - **URL:** `https://rwl-api.vercel.app/api/capture`
   - Expand **Show More**:
     - **Method:** `POST`
     - **Headers:** add two —
       - `Authorization` → `Bearer ` followed by your token (paste the token
         Claude copies to your clipboard; the value should read
         `Bearer abc123…`).
       - `Content-Type` → `application/json`
     - **Request Body:** `JSON`, then add three fields (tap **Add new field →
       Text**):
       - `url`  → value = the **URLs** variable from step 3
       - `note` → value = the **Provided Input** variable from step 4
       - `source` → value = `ios-shortcut` (plain text)
   - Using the JSON request-body fields (not a hand-typed JSON string) means
     Shortcuts escapes quotes/newlines in your note for you.

6. *(Optional, recommended)* Add action **Show Notification** after step 5 so a
   capture confirms visually. Set the body to the
   **Contents of URL** result (it returns `{"status":"created", …}` or
   `{"status":"updated", …}`).

7. **Done.** The Shortcut now lives in your share sheet.

---

## Use it

From Safari (or any app) → **Share** → **Save to RWL** → optionally type a note
→ **Done**. The link lands in Shiori within a few seconds, and the response
notification shows `created` (new) or `updated` (you'd saved it before).

## Verify

- Share a link from Safari.
- Check your **Shiori inbox** — the bookmark should appear.
- Re-sharing the same link shows `updated` (it dedupes; no second bookmark).

## Troubleshooting

- **401 / unauthorized:** the `Authorization` header is wrong. It must be the
  word `Bearer`, a space, then the token — no quotes.
- **Could not parse / 400:** check the request body is set to **JSON** with the
  three Text fields, and `Content-Type` is `application/json`.
- **Token rotation:** if the token is ever rotated (U14 runbook), update the
  `Authorization` header value here and re-save the Shortcut.
