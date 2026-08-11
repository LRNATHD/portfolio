/**
 * about.js — Clean, full-width About Me view with contact form
 */

export function createAboutView() {
  const el = document.createElement('div');
  el.className = 'about-view view';
  el.innerHTML = `
    <div class="about-container full-width-layout">
      <header class="about-header">
        <h1>About Me</h1>
      </header>

      <main class="about-content">
        <p class="placeholder-text">
          Hi, I'm Noah. I'm a hardware engineer and PCB designer specializing in microcontroller implementation, power systems, and embedded programming.
        </p>
        <p class="placeholder-text">
          This is a clean space for me to write about my background, work, and future projects.
        </p>
      </main>

      <section class="contact-section" id="contact-form">
        <div class="contact-divider"></div>
        <h2 class="contact-heading">Get in Touch</h2>
        <p class="contact-subtext">Have a question or want to work together? Send me a message.</p>

        <form
          class="contact-form"
          action="https://formsubmit.co/me@noahsmith.dev"
          method="POST"
          id="contact-form-element"
        >
          <!-- Formsubmit config -->
          <input type="hidden" name="_subject" value="New message from noahsmith.dev">
          <input type="hidden" name="_captcha" value="false">
          <input type="hidden" name="_template" value="table">
          <input type="text" name="_honey" style="display:none">

          <div class="contact-form__row">
            <div class="contact-form__field">
              <label for="contact-email" class="contact-form__label">Your Email</label>
              <input
                type="email"
                id="contact-email"
                name="email"
                class="contact-form__input"
                placeholder="you@example.com"
                required
                autocomplete="email"
              />
            </div>
            <div class="contact-form__field">
              <label for="contact-subject" class="contact-form__label">Subject</label>
              <input
                type="text"
                id="contact-subject"
                name="_subject"
                class="contact-form__input"
                placeholder="What's this about?"
                required
              />
            </div>
          </div>

          <div class="contact-form__field">
            <label for="contact-message" class="contact-form__label">Message</label>
            <textarea
              id="contact-message"
              name="message"
              class="contact-form__input contact-form__textarea"
              placeholder="Write your message here..."
              rows="6"
              required
            ></textarea>
          </div>

          <button type="submit" class="contact-form__submit" id="contact-submit">
            <span class="contact-form__submit-text">Send Message</span>
            <span class="contact-form__submit-icon">→</span>
          </button>
        </form>
      </section>
    </div>
  `;
  return el;
}
