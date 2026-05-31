(function () {
  const form = document.querySelector('.ct-form');
  if (!form) return;

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearError(form);

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
      email:     form.querySelector('#ct-email').value.trim(),
      company:   form.querySelector('#ct-company').value.trim(),
      role:      form.querySelector('#ct-role').value,
      biTools,
      message:   form.querySelector('#ct-msg').value.trim(),
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
    let el = form.querySelector('.ct-form__error');
    if (!el) {
      el = document.createElement('p');
      el.className = 'ct-form__error';
      form.querySelector('.ct-submit').prepend(el);
    }
    el.textContent = message;
  }

  function clearError(form) {
    form.querySelector('.ct-form__error')?.remove();
  }
})();
