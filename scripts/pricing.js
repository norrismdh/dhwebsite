(function () {
  const form = document.querySelector('.quote__form');
  if (!form) return;

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearError(form);

    const emailVal = form.querySelector('#q-email').value.trim();
    if (window.dhIsBusinessEmail && !window.dhIsBusinessEmail(emailVal)) {
      showError(form, window.DH_BUSINESS_EMAIL_MESSAGE);
      form.querySelector('#q-email').focus();
      return;
    }

    const btn = form.querySelector('button[type=submit]');
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Sending&hellip;';

    const tools   = form.querySelector('#q-tools').value;
    const useCase = form.querySelector('#q-usecase').value;
    const users   = form.querySelector('#q-users').value;

    const contextLines = [
      tools   && `Analytics tools in stack: ${tools}`,
      useCase && `Primary use case: ${useCase}`,
      users   && `Approximate user count: ${users}`,
    ].filter(Boolean);

    const utm = typeof window.DH_getUtm === 'function' ? window.DH_getUtm() : {};

    const payload = {
      firstName:  form.querySelector('#q-first').value.trim(),
      lastName:   form.querySelector('#q-last').value.trim(),
      email:      form.querySelector('#q-email').value.trim(),
      company:    form.querySelector('#q-company').value.trim(),
      role:       form.querySelector('#q-role').value,
      leadSource: 'Website - Quote Request',
      message:    contextLines.join('\n'),
      utm,
    };

    try {
      const res = await fetch('/api/submit-lead', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });

      if (res.ok) {
        window.location.href = 'thank-you.html';
        return;
      }

      const data = await res.json().catch(() => ({}));
      showError(form, data.error ?? 'Something went wrong. Please try again.');
    } catch {
      showError(form, 'Network error. Please check your connection and try again.');
    }

    btn.disabled = false;
    btn.innerHTML = originalHTML;
  });

  function showError(form, message) {
    let el = form.querySelector('.quote__form__error');
    if (!el) {
      el = document.createElement('p');
      el.className = 'quote__form__error';
      el.style.cssText = 'color:var(--danger);font-size:var(--fs-14);margin:0 0 var(--space-4);';
      form.querySelector('.quote__form-submit').prepend(el);
    }
    el.textContent = message;
  }

  function clearError(form) {
    form.querySelector('.quote__form__error')?.remove();
  }
})();
