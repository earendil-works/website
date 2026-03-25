---
title: Unsubscribe
template: page
aria_label: Unsubscribe from Earendil emails
---

<div id="unsubscribe-form">
  <p>Enter your email address to unsubscribe from all newsletters.</p>
  <p class="updates-form-area" style="margin:16px 0">
    <span class="updates-input-wrapper">
      <input type="email" id="unsubscribe-email" class="updates-input" placeholder="your@email.com" style="width:100%;min-width:260px" />
      <span id="unsubscribe-enter" class="updates-enter" style="cursor:pointer" title="Unsubscribe">↩</span>
    </span>
  </p>
  <p id="unsubscribe-message" style="min-height:1.6em"></p>
</div>

<script>
  (function () {
    var input = document.getElementById('unsubscribe-email');
    var enterBtn = document.getElementById('unsubscribe-enter');
    var messageEl = document.getElementById('unsubscribe-message');
    var busy = false;

    // Pre-fill from ?email= query parameter
    var params = new URLSearchParams(window.location.search);
    var prefill = params.get('email');
    if (prefill) {
      input.value = prefill;
    }

    function showMessage(text) {
      messageEl.textContent = text;
    }

    function submit() {
      if (busy) return;
      var email = (input.value || '').trim();
      if (!email || email.indexOf('@') === -1) {
        showMessage('Please enter a valid email address.');
        return;
      }
      busy = true;
      showMessage('Unsubscribing\u2026');

      fetch('https://lefos.com/api/newsletter/unsubscribe-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      })
      .then(function (response) {
        if (!response.ok) throw new Error('request_failed');
        return response.json();
      })
      .then(function () {
        showMessage('You have been unsubscribed.');
        input.disabled = true;
      })
      .catch(function () {
        showMessage('Something went wrong. Please try again.');
      })
      .finally(function () {
        busy = false;
      });
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });
    enterBtn.addEventListener('click', submit);
  })();
</script>
