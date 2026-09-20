// RealTalk Web Frontend Logic

// If web is hosted on separate domain (e.g. GitHub Pages or noahsmith.dev/realtalk),
// API_BASE_URL can point to your Cloudflare Worker URL (e.g., "https://realtalk.noahsmith.dev" or "/").
const API_BASE_URL = window.API_BASE_URL || "https://realtalk-printer-bridge.super-disk-489b.workers.dev";

// DOM Elements
const quoteForm = document.getElementById("quoteForm");
const quoteText = document.getElementById("quoteText");
const quoteAuthor = document.getElementById("quoteAuthor");
const charCount = document.getElementById("charCount");
const submitBtn = document.getElementById("submitBtn");

// Preview Elements
const previewQuote = document.getElementById("previewQuote");
const previewAuthor = document.getElementById("previewAuthor");
const previewDate = document.getElementById("previewDate");
const previewTime = document.getElementById("previewTime");

// Status Elements
const statusCard = document.getElementById("statusCard");
const statusTitle = document.getElementById("statusTitle");
const statusDesc = document.getElementById("statusDesc");
const progressBar = document.getElementById("progressBar");
const queueIdText = document.getElementById("queueIdText");
const printedTimeText = document.getElementById("printedTimeText");

// Initialize preview timestamp
function updateTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  
  const hours = String(now.getHours()).padStart(2, "0");
  const mins = String(now.getMinutes()).padStart(2, "0");
  const secs = String(now.getSeconds()).padStart(2, "0");

  if (previewDate) previewDate.textContent = `${year}-${month}-${day}`;
  if (previewTime) previewTime.textContent = `${hours}:${mins}:${secs} LOCAL`;
}

updateTimestamp();
setInterval(updateTimestamp, 1000);

// Live Preview Updater
function updatePreview() {
  const text = quoteText.value.trim();
  const author = quoteAuthor.value.trim();

  // Character counter
  const len = quoteText.value.length;
  charCount.textContent = `${len} / 280`;

  if (len > 250) {
    charCount.style.color = "#ef4444";
  } else if (len > 200) {
    charCount.style.color = "#f59e0b";
  } else {
    charCount.style.color = "var(--text-dim)";
  }

  // Quote preview
  if (text) {
    previewQuote.textContent = text;
  } else {
    previewQuote.textContent = "Your quote will appear here. As you type, this preview updates live to match what gets rendered onto the physical thermal paper.";
  }

  // Author preview
  previewAuthor.textContent = author ? author : "Anonymous";

  // Dynamic font sizing for label preview
  if (text.length < 50) {
    previewQuote.style.fontSize = "1.35rem";
  } else if (text.length < 120) {
    previewQuote.style.fontSize = "1.15rem";
  } else if (text.length < 200) {
    previewQuote.style.fontSize = "1.0rem";
  } else {
    previewQuote.style.fontSize = "0.88rem";
  }
}

quoteText.addEventListener("input", updatePreview);
quoteAuthor.addEventListener("input", updatePreview);

// Form Submission & Status Polling
quoteForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const text = quoteText.value.trim();
  const author = quoteAuthor.value.trim();

  if (!text) {
    alert("Please enter a quote before printing.");
    return;
  }

  // Disable button and show status card
  submitBtn.disabled = true;
  submitBtn.querySelector(".btn-text").textContent = "Transmitting...";
  statusCard.classList.remove("hidden");
  statusTitle.textContent = "Sending to Printer Bridge...";
  statusDesc.textContent = "Sending your quote through the Cloudflare Worker to Noah's Android phone.";
  progressBar.style.width = "25%";
  progressBar.style.background = "var(--accent)";
  queueIdText.textContent = "Job ID: connecting...";
  printedTimeText.textContent = "";

  try {
    const response = await fetch(`${API_BASE_URL}/api/quote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text,
        author: author || "Anonymous"
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to queue print job.");
    }

    const quoteId = data.id;
    queueIdText.textContent = `Job ID: ${quoteId}`;
    statusTitle.textContent = "In Print Queue";
    statusDesc.textContent = "Delivered to cloud queue. Waiting for Noah's Android bridge to receive and send to NULLTONEX printer...";
    progressBar.style.width = "60%";

    // Poll for print status
    pollPrintStatus(quoteId);

  } catch (err) {
    statusTitle.textContent = "Transmission Failed";
    statusDesc.textContent = err.message;
    progressBar.style.background = "var(--danger)";
    progressBar.style.width = "100%";
    submitBtn.disabled = false;
    submitBtn.querySelector(".btn-text").textContent = "Try Again";
  }
});

// Status Poller
async function pollPrintStatus(quoteId) {
  let attempts = 0;
  const maxAttempts = 60; // 60 * 2s = 2 minutes timeout

  const interval = setInterval(async () => {
    attempts++;

    try {
      const res = await fetch(`${API_BASE_URL}/api/quote/status?id=${quoteId}`);
      if (!res.ok) return;

      const data = await res.json();

      if (data.status === "printed") {
        clearInterval(interval);
        statusTitle.textContent = "Printed on Noah's Desk! 🎉";
        statusDesc.textContent = "The NULLTONEX thermal printer just successfully printed your quote on a 4x6\" label!";
        progressBar.style.width = "100%";
        progressBar.style.background = "#10b981";
        
        const printDate = new Date(data.printedAt || Date.now());
        printedTimeText.textContent = `Printed at ${printDate.toLocaleTimeString()}`;

        // Reset form after short delay
        setTimeout(() => {
          submitBtn.disabled = false;
          submitBtn.querySelector(".btn-text").textContent = "Print Another Quote";
        }, 5000);
      } else if (data.status === "failed") {
        clearInterval(interval);
        statusTitle.textContent = "Print Error";
        statusDesc.textContent = "The Android bridge reported a printer communication error.";
        progressBar.style.background = "var(--danger)";
        submitBtn.disabled = false;
        submitBtn.querySelector(".btn-text").textContent = "Try Again";
      }

    } catch (e) {
      console.warn("Status poll error:", e);
    }

    if (attempts >= maxAttempts) {
      clearInterval(interval);
      statusTitle.textContent = "Queued on Desk";
      statusDesc.textContent = "Your quote is in queue! If Noah's printer is currently off or sleeping, it will print as soon as it reconnects.";
      submitBtn.disabled = false;
      submitBtn.querySelector(".btn-text").textContent = "Print Another Quote";
    }
  }, 2000);
}
