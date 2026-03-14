---
title: Subscribe to posts
template: page
overlay_class: overlay--posts
aria_label: Subscribe to Earendil posts
---

<span data-i18n="subscribe.subscribe.title">Hear from Earendil</span>

<div class="updates-form-area" data-subscribe-form>
  <div class="updates-input-wrapper">
    <input
      type="text"
      id="updates-email"
      name="fake-field-to-disable-autofill"
      class="updates-input placeholder-text"
      placeholder="your@email.com"
      data-i18n-placeholder="subscribe.subscribe.placeholder"
      autocomplete="off"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
      aria-label="Email address"
      data-1p-ignore="true"
      data-lpignore="true"
      data-form-type="other"
      value=""
    >
    <span id="updates-enter" class="updates-enter" hidden>↵</span>
  </div>
  <span id="updates-message" class="updates-message" hidden></span>
</div>

<a href="/posts/feed.atom" hx-boost="false" data-i18n="posts.posts.feedAtom">Atom</a> · <a href="/posts/feed.rss" hx-boost="false" data-i18n="posts.posts.feedRss">RSS</a>
