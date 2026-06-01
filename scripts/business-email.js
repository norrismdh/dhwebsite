/* Shared business-email guard for all lead/contact forms.
 * Rejects free/consumer/disposable email providers so we capture work emails.
 * Keep the domain list in sync with api/_business-email.js (server-side enforcement). */
(function () {
  var BLOCKED = new Set([
    // Google
    'gmail.com', 'googlemail.com',
    // Microsoft
    'outlook.com', 'outlook.co.uk', 'hotmail.com', 'hotmail.co.uk', 'hotmail.fr',
    'live.com', 'live.co.uk', 'msn.com',
    // Yahoo / AOL
    'yahoo.com', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.ca', 'yahoo.in', 'ymail.com',
    'rocketmail.com', 'aol.com', 'aim.com',
    // Apple
    'icloud.com', 'me.com', 'mac.com',
    // Other global consumer
    'gmx.com', 'gmx.net', 'gmx.de', 'mail.com', 'email.com', 'usa.com',
    'proton.me', 'protonmail.com', 'pm.me', 'yandex.com', 'yandex.ru',
    'fastmail.com', 'hey.com', 'hushmail.com', 'tutanota.com', 'tuta.io', 'zohomail.com',
    // US ISPs
    'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'bellsouth.net',
    'cox.net', 'charter.net', 'earthlink.net', 'frontier.com', 'optonline.net',
    'roadrunner.com', 'juno.com', 'netzero.net',
    // Regional consumer
    'mail.ru', 'inbox.ru', 'list.ru', 'bk.ru', 'qq.com', '163.com', '126.com',
    'sina.com', 'foxmail.com', 'naver.com', 'daum.net', 'web.de', 't-online.de',
    'freenet.de', 'orange.fr', 'laposte.net', 'free.fr', 'wanadoo.fr', 'sfr.fr',
    'libero.it', 'virgilio.it', 'tiscali.it', 'uol.com.br', 'bol.com.br', 'terra.com',
    'seznam.cz', 'rediffmail.com', 'btinternet.com', 'sky.com', 'talktalk.net',
    'ntlworld.com', 'shaw.ca', 'rogers.com', 'sympatico.ca', 'telus.net',
    'bigpond.com', 'optusnet.com.au',
    // Disposable / throwaway
    'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', '10minutemail.com',
    'tempmail.com', 'temp-mail.org', 'getnada.com', 'throwaway.email', 'yopmail.com',
    'dispostable.com', 'sharklasers.com', 'maildrop.cc', 'trashmail.com', 'fakeinbox.com',
    'mintemail.com', 'mohmal.com', 'spam4.me', 'mailnesia.com', 'tempmailo.com',
    'emailondeck.com', 'mailcatch.com', 'si.llanhai.com', 'wz.ddip88.com', 'dzhi.org'
  ]);

  function domain(email) {
    return String(email || '').trim().toLowerCase().split('@')[1] || '';
  }

  /* Returns true only for a syntactically plausible non-blocked (business) domain. */
  window.dhIsBusinessEmail = function (email) {
    var d = domain(email);
    return !!d && d.indexOf('.') !== -1 && !BLOCKED.has(d);
  };

  window.DH_BUSINESS_EMAIL_MESSAGE =
    'Please use your work email address — free or personal email providers (e.g. Gmail, Outlook, Yahoo) aren’t accepted.';
})();
