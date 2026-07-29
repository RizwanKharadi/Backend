/**
 * TallyFin marketing site — interactions
 */
(function () {
  'use strict';

  const header = () => document.getElementById('site-header');
  const navToggle = () => document.getElementById('nav-toggle');
  const mobileNav = () => document.getElementById('mobile-nav');

  function initNav() {
    const toggle = navToggle();
    const mobile = mobileNav();
    if (!toggle || !mobile) return;

    toggle.addEventListener('click', () => {
      const open = mobile.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open);
      mobile.setAttribute('aria-hidden', !open);
      document.body.style.overflow = open ? 'hidden' : '';
    });

    mobile.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        mobile.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        mobile.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
      });
    });
  }

  function initScrollHeader() {
    const h = header();
    if (!h) return;

    const darkSections = document.querySelectorAll('[data-header-dark]');
    let onDark = false;

    function update() {
      const y = window.scrollY;
      h.classList.toggle('is-scrolled', y > 20);

      onDark = false;
      darkSections.forEach((section) => {
        const rect = section.getBoundingClientRect();
        if (rect.top < 60 && rect.bottom > 60) onDark = true;
      });
      h.classList.toggle('on-dark', onDark);
    }

    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  function initReveal() {
    const els = document.querySelectorAll('.reveal');
    if (!els.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );

    els.forEach((el) => observer.observe(el));
  }

  function initFaq() {
    document.querySelectorAll('.faq-question').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.faq-item');
        const wasOpen = item.classList.contains('is-open');
        document.querySelectorAll('.faq-item.is-open').forEach((i) => i.classList.remove('is-open'));
        if (!wasOpen) item.classList.add('is-open');
        btn.setAttribute('aria-expanded', !wasOpen);
      });
    });
  }

  function initContactForm() {
    const form = document.getElementById('contact-form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const name = data.get('name') || 'Visitor';
      const email = data.get('email') || '';
      const message = data.get('message') || '';
      const subject = encodeURIComponent('TallyFin — Contact from ' + name);
      const body = encodeURIComponent('Name: ' + name + '\nEmail: ' + email + '\n\n' + message);
      const mailto = (window.TALLYFIN_CONFIG && window.TALLYFIN_CONFIG.contactEmail) || 'support@tallyfin.com';
      window.location.href = 'mailto:' + mailto + '?subject=' + subject + '&body=' + body;
    });
  }

  function initSmoothAnchors() {
    document.querySelectorAll('a[href^="#"]').forEach((a) => {
      a.addEventListener('click', (e) => {
        const id = a.getAttribute('href').slice(1);
        const target = document.getElementById(id);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  function boot() {
    initNav();
    initScrollHeader();
    initReveal();
    initFaq();
    initContactForm();
    initSmoothAnchors();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
