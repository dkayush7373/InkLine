# Inkline

> "Write it down. Draw the line."

Inkline feels like a well-made paper notebook. You write a task, and when it is done you draw a line through it. Calm, confident, and editorial. Not a SaaS dashboard, not a gamified tracker.

---

## Design System & Signature Details

Inkline is built strictly with Vanilla HTML, CSS, and JavaScript with zero external frameworks and zero build steps:

- **Paper and Ink Palette**: Light paper (`#F6F2E9`), dark slate (`#141414`), with a single accent color: "red pencil" (`#B8412B` in light, `#F08A6C` in dark).
- **Typography**: Editorial Fraunces serif for headings and big dates; Inter for crisp, readable UI.
- **Ruled Paper Canvas**: Subtle horizontal ruled notebook lines and a thin vertical margin line behind the task list.
- **Ink Strike-Through**: Completing draws an accent line across the task title from left to right (200ms clip-path), and the checkbox draws its checkmark with stroke-dashoffset.
- **Left Edge Priority**: High (3px accent), Medium (2px at 60% opacity), Low (1px muted). Priority is also written in text.
- **Field-Note Metadata**: Clean uppercase metadata under each title (`HIGH · WORK · DUE TODAY`).
- **Sliding Underline Tabs**: Typographic tabs with an animated 2px accent underline sliding between views in 180ms.
- **All Clear Moment**: When all tasks due today are completed, a serif "All clear." presentation draws in.
- **4-Second Undo Toast**: Card with a 3px accent top bar, task title, and an UNDO button. Rapid deletes are queued and popped newest first.
- **Focus Rings**: 2px solid accent outline with 2px offset on all interactive elements.

---

## Local Development

Because Inkline requires no build tools or package managers to run in production, you can open and run it immediately:

### Option 1: Any static server (Python or Node)
Using Python:
```bash
python -m http.server 8000
```
Open `http://localhost:8000` in your browser.

Using Node's npx serve:
```bash
npx serve .
```

### Option 2: Quality Gate and Automated Testing
Inkline includes an automated test runner for local verification:
```bash
# Run syntax and linter checks
npm run lint

# Run automated domain logic, validation, and date tests
npm test
```

### Option 3: Browser Self-Test Suite
Open Inkline in your browser, open the browser DevTools Console, and run:
```javascript
window.inklineSelfTest();
```
This tests record validation, case-insensitive duplicate rejection, completion timestamp handling, delete and undo restoration, date logic, and corrupted storage isolation on a temporary storage key without modifying your real tasks.

---

## Keyboard Shortcuts

- `N`: Focus the "What needs doing?" task input
- `/`: Focus the search bar
- `?`: Open the keyboard shortcuts guide
- `Esc`: Close open dialogs or cancel inline task edit
- `Enter`: Save new task or save inline edit

Shortcuts are automatically disabled while typing in an input field.

---

## Deployment: Netlify Drop Step-by-Step

Because Inkline has no build step, it can be deployed to Netlify Drop in seconds:

1. **Prepare files**: Ensure your folder contains `index.html`, `style.css`, `app.js`, `privacy.html`, `terms.html`, `404.html`, `favicon.svg`, `favicon.png`, and `apple-touch-icon.png`.
2. **Visit Netlify Drop**: Go to [app.netlify.com/drop](https://app.netlify.com/drop) in your web browser.
3. **Upload**: Drag and drop the repository folder directly into the upload area on Netlify.
4. **Instant URL**: Netlify will provide a live public URL (e.g., `https://calm-inkline-123456.netlify.app`).

### Connecting a Custom Domain
1. In your Netlify dashboard, navigate to **Site configuration** > **Domain management**.
2. Click **Add a domain** and type your custom domain name (e.g. `inkline.yourdomain.com`).
3. Add the required DNS records at your domain registrar:
   - For an apex domain (`example.com`): Add an `A` record pointing to Netlify's load balancer IP `75.2.60.5`.
   - For a subdomain (`todo.example.com`): Add a `CNAME` record pointing to your site's Netlify subdomain (e.g. `calm-inkline-123456.netlify.app`).

### Enabling HTTPS
1. In Netlify under **Domain management**, scroll down to **HTTPS**.
2. Netlify provisions an automatic, free Let's Encrypt SSL/TLS certificate as soon as your DNS records have propagated.
3. Click **Verify DNS configuration** and enable **Force HTTPS** to redirect all HTTP traffic to HTTPS.

---

## Post-Deploy Checklist

- [ ] Verify homepage loads at root URL with correct `<title>` (`Inkline | A calm to-do list`).
- [ ] Confirm no theme flash occurs when switching between light, dark, and system themes.
- [ ] Run `window.inklineSelfTest()` in production console to verify browser storage integrity.
- [ ] Test task creation, inline edit, completion strike-through, and 4-second undo toast.
- [ ] Test search, tab filtering, and sorting (Created, Due Date, Priority, Manual drag).
- [ ] Check mobile view at 360px width to ensure sticky bottom add bar and no horizontal overflow.
- [ ] Confirm `privacy.html`, `terms.html`, and `404.html` render cleanly with footer links.
- [ ] Validate JSON export and import using the Backup & Restore dialog.

---

## License

MIT License. Designed and engineered for calm, distraction-free productivity.