# TallyFin marketing website

Static **HTML + CSS + JavaScript** showcase site. No backend, no API calls — easy to host on any web server, CDN, or shared hosting.

## Pages

| File | Purpose |
|------|---------|
| `index.html` | Home |
| `features.html` | Product features |
| `pricing.html` | Plans (static; edit `js/config.js`) |
| `setup.html` | 3-step setup guide |
| `download.html` | Desktop agent + mobile links |
| `faq.html` | FAQ |
| `contact.html` | Contact (mailto form) |
| `privacy.html` | Privacy policy template |
| `terms.html` | Terms template |
| `disclaimer.html` | Trademark disclaimer |

## Before you publish

1. Edit **`js/config.js`** — email, phone, address, download URL, Play Store link, pricing.
2. Put the Windows installer in **`downloads/TallyFin-Desktop-Agent-Setup.exe`** (see `downloads/README.md`).
3. Replace legal copy in `privacy.html` and `terms.html` with lawyer-approved text.
4. Update testimonial quotes on `index.html` when you have real customers.

## Local preview

**Option A — Python**

```powershell
cd website
python -m http.server 8080
```

Open http://localhost:8080

**Option B — PHP built-in server** (if you prefer PHP hosting later)

```powershell
cd website
php -S localhost:8080
```

**Option C — Open `index.html` in a browser**

Header/footer injection works on `http://` servers. Opening files directly (`file://`) may block some scripts in strict browsers — use a local server instead.

## Hosting

Upload the entire `website/` folder contents to your host document root (e.g. `public_html` for cPanel).

| Host | Steps |
|------|--------|
| **cPanel / shared hosting** | Upload via File Manager or FTP to `public_html`. Point domain to that folder. |
| **Apache** | Enable `mod_rewrite` optional; site works without it. |
| **Nginx** | `root /var/www/tallyfin;` + `try_files $uri $uri/ =404;` |
| **Netlify / Vercel** | Deploy folder as static site; no build step. |
| **GitHub Pages** | Push `website/` contents to `gh-pages` branch or use `/docs` folder. |

Recommended: `www.aiminfocom.com` → this folder; apex domain redirects to `www`.

## PHP variant (optional)

This site does not require PHP. If your host only supports PHP includes, you can rename pages to `.php` and replace `components.js` header/footer with:

```php
<?php include 'partials/header.php'; ?>
```

The current JS injection keeps one place to edit navigation without PHP.

## Structure

```
website/
├── index.html
├── *.html
├── css/main.css
├── js/config.js      ← edit me
├── js/components.js  ← nav + footer
├── js/main.js
├── assets/favicon.svg
└── downloads/        ← place .exe here
```
