/**
 * Injects shared header & footer. Edit links once here.
 */
(function () {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  const isActive = (href) => (path === href || (path === '' && href === 'index.html')) ? ' is-active' : '';

  const headerHTML = `
    <header class="site-header" id="site-header">
      <div class="nav-inner">
        <a href="index.html" class="logo" aria-label="TallyFin home">
          <span class="logo-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M4 6h16v2H4V6zm0 5h10v2H4v-2zm0 5h14v2H4v-2z"/></svg>
          </span>
          TallyFin
        </a>
        <nav aria-label="Main">
          <ul class="nav-links">
            <li><a href="features.html" class="${isActive('features.html')}">Features</a></li>
            <li><a href="pricing.html" class="${isActive('pricing.html')}">Pricing</a></li>
            <li><a href="setup.html" class="${isActive('setup.html')}">Setup</a></li>
            <li><a href="faq.html" class="${isActive('faq.html')}">FAQ</a></li>
            <li><a href="contact.html" class="${isActive('contact.html')}">Contact</a></li>
          </ul>
        </nav>
        <div class="nav-cta">
          <a href="download.html" class="btn btn-primary">Download</a>
          <button class="nav-toggle" id="nav-toggle" aria-label="Open menu" aria-expanded="false">
            <span></span><span></span>
          </button>
        </div>
      </div>
    </header>
    <nav class="mobile-nav" id="mobile-nav" aria-hidden="true">
      <a href="features.html">Features</a>
      <a href="pricing.html">Pricing</a>
      <a href="setup.html">Setup</a>
      <a href="faq.html">FAQ</a>
      <a href="contact.html">Contact</a>
      <a href="download.html" class="btn btn-primary btn-lg">Download</a>
    </nav>
  `;

  const footerHTML = `
    <footer class="site-footer">
      <div class="container-wide">
        <div class="footer-grid">
          <div class="footer-brand">
            <a href="index.html" class="logo">
              <span class="logo-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M4 6h16v2H4V6zm0 5h10v2H4v-2zm0 5h14v2H4v-2z"/></svg>
              </span>
              TallyFin
            </a>
            <p>TallyPrime and Tally ERP 9 on your phone. Secure sync from your desktop. Built for Indian businesses.</p>
          </div>
          <div class="footer-col">
            <h4>Product</h4>
            <ul>
              <li><a href="features.html">Features</a></li>
              <li><a href="pricing.html">Pricing</a></li>
              <li><a href="setup.html">How it works</a></li>
              <li><a href="download.html">Download</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h4>Support</h4>
            <ul>
              <li><a href="faq.html">FAQ</a></li>
              <li><a href="contact.html">Contact</a></li>
              <li><a href="setup.html">Setup guide</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h4>Legal</h4>
            <ul>
              <li><a href="privacy.html">Privacy</a></li>
              <li><a href="terms.html">Terms</a></li>
              <li><a href="disclaimer.html">Disclaimer</a></li>
            </ul>
          </div>
        </div>
        <div class="footer-bottom">
          <span>Copyright &copy; ${new Date().getFullYear()} TallyFin. All rights reserved.</span>
          <span>Tally is a trademark of its respective owner. TallyFin is not affiliated with Tally Solutions.</span>
        </div>
      </div>
    </footer>
  `;

  const headerEl = document.getElementById('site-header-mount');
  const footerEl = document.getElementById('site-footer-mount');
  if (headerEl) headerEl.outerHTML = headerHTML;
  if (footerEl) footerEl.outerHTML = footerHTML;
})();
