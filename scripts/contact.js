(function () {
  const form = document.querySelector('.ct-form');
  if (!form) return;

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearError(form);

    if (!form.checkValidity()) { form.reportValidity(); return; }

    const emailField = form.querySelector('#ct-email');
    const emailVal = emailField.value.trim();
    if (window.dhIsBusinessEmail && !window.dhIsBusinessEmail(emailVal)) {
      showError(form, window.DH_BUSINESS_EMAIL_MESSAGE, emailField);
      emailField.focus();
      return;
    }

    const btn = form.querySelector('button[type=submit]');
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Sending&hellip;';

    const biTools = Array.from(
      form.querySelectorAll('.ct-chips input[type=checkbox]:checked')
    ).map(cb => cb.closest('label').textContent.trim());

    const utm = typeof window.DH_getUtm === 'function' ? window.DH_getUtm() : {};

    const payload = {
      firstName: form.querySelector('#ct-first').value.trim(),
      lastName:  form.querySelector('#ct-last').value.trim(),
      email:     emailVal,
      company:   form.querySelector('#ct-company').value.trim(),
      jobTitle:  form.querySelector('#ct-title').value.trim(),
      role:      form.querySelector('#ct-role').value,
      biTools,
      topic:     form.querySelector('#ct-topic').value,
      message:   form.querySelector('#ct-msg').value.trim(),
      leadSource: 'Website Contact',
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

  function showError(form, message, field) {
    let el = form.querySelector('.ct-form__error');
    if (!el) {
      el = document.createElement('p');
      el.className = 'ct-form__error';
      el.id = 'ct-form-error';
      // role=alert so the message is announced the moment it appears. Without
      // it the only cue a screen-reader user gets is focus jumping to a field,
      // with no explanation of what went wrong.
      el.setAttribute('role', 'alert');
      form.querySelector('.ct-submit').prepend(el);
    }
    el.textContent = message;
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-describedby', el.id);
    }
  }

  function clearError(form) {
    form.querySelector('.ct-form__error')?.remove();
    form.querySelectorAll('[aria-invalid="true"]').forEach(function (el) {
      el.removeAttribute('aria-invalid');
      el.removeAttribute('aria-describedby');
    });
  }
})();
