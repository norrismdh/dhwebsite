(function () {
  const form = document.querySelector('.par-form');
  if (!form) return;

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearError();
    if (!form.checkValidity()) { form.reportValidity(); return; }

    const emailVal = form.querySelector('#par-email').value.trim();
    if (window.dhIsBusinessEmail && !window.dhIsBusinessEmail(emailVal)) {
      showError(window.DH_BUSINESS_EMAIL_MESSAGE);
      form.querySelector('#par-email').focus();
      return;
    }

    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Sending…';

    const data = {
      firstName:       form.querySelector('#par-first').value.trim(),
      lastName:        form.querySelector('#par-last').value.trim(),
      email:           emailVal,
      company:         form.querySelector('#par-company').value.trim(),
      website:         form.querySelector('#par-website').value.trim(),
      partnerType:     form.querySelector('#par-type').value,
      region:          form.querySelector('#par-region').value,
      message:         form.querySelector('#par-msg').value.trim(),
      leadSource:      'Website Partners',
    };

    try {
      const res  = await fetch('/api/submit-lead', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Unknown error');
      window.location.href = 'thank-you.html';
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Submit application';
      showError(err.message || 'Something went wrong. Please try again.');
    }
  });

  function showError(message) {
    clearError();
    const el = document.createElement('p');
    el.className = 'ct-form__error';
    el.textContent = message;
    form.querySelector('.ct-submit').prepend(el);
  }

  function clearError() {
    form.querySelector('.ct-form__error')?.remove();
  }
})();
