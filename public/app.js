// HealthAI front end: no framework, no build step. All patient-provided and
// model-provided text is rendered with textContent, never innerHTML.

const MIN_LENGTH = 10; // keep in sync with src/domain/schemas.ts
const MAX_LENGTH = 1000;
const REQUEST_TIMEOUT_MS = 90_000;

const URGENCY_LABELS = {
  self_care: "Self-care",
  see_doctor: "See a doctor",
  urgent_care: "Urgent care today",
  emergency: "Emergency",
};

const $ = (id) => document.getElementById(id);

// ---------- Anonymous client id (scopes history to this browser) ----------

function getClientId() {
  try {
    let id = localStorage.getItem("healthai.clientId");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("healthai.clientId", id);
    }
    return id;
  } catch {
    // Storage blocked (private mode etc.): history lasts for this page load only.
    return (getClientId.fallback ??= crypto.randomUUID());
  }
}

// ---------- API ----------

class ApiError extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

async function api(path, { method = "GET", body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", "X-Client-Id": getClientId() },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    throw new ApiError(
      err.name === "AbortError"
        ? "The request took too long. Please try again."
        : "Can't reach HealthAI. Check your internet connection and try again.",
    );
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(data?.error?.message ?? `Request failed (${res.status}).`, data?.error?.details);
  }
  return data;
}

// ---------- Validation (mirrors the server; the server remains the authority) ----------

export function validateSymptoms(raw) {
  const text = raw.trim();
  if (text.length === 0) return "Please describe your symptoms.";
  if (text.length < MIN_LENGTH) return `Please describe your symptoms in at least ${MIN_LENGTH} characters.`;
  if (text.length > MAX_LENGTH) return `Please keep your description under ${MAX_LENGTH} characters.`;
  if (!/\p{L}{2,}/u.test(text)) return "Please describe your symptoms in words.";
  return null;
}

function setFieldError(message) {
  $("symptoms-error").textContent = message ?? "";
  $("symptoms").setAttribute("aria-invalid", message ? "true" : "false");
}

// ---------- Rendering ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function fillList(ul, items) {
  ul.replaceChildren(...items.map((item) => el("li", "", item)));
}

function renderResult(record) {
  const { analysis, redFlags, meta } = record;
  const card = $("result-template").content.firstElementChild.cloneNode(true);

  const isEmergency = redFlags.length > 0 || analysis.urgency === "emergency";
  if (isEmergency) {
    const box = card.querySelector(".emergency");
    box.hidden = false;
    box.querySelector(".emergency-text").textContent = redFlags.length
      ? `Your description mentions: ${redFlags.join(", ")}. Call your local emergency number.`
      : "Your symptoms may need immediate attention. Call your local emergency number.";
  }

  const badge = card.querySelector(".urgency");
  badge.textContent = URGENCY_LABELS[analysis.urgency] ?? analysis.urgency;
  badge.classList.add(analysis.urgency);

  card.querySelector(".meta").textContent = meta.cached
    ? `⚡ From cache in ${meta.latencyMs < 1 ? "<1" : meta.latencyMs} ms`
    : `Analysed in ${(meta.latencyMs / 1000).toFixed(1)} s`;
  card.querySelector(".summary").textContent = analysis.summary;

  const list = card.querySelector(".conditions");
  for (const c of analysis.conditions) {
    const li = el("li", "condition");
    const head = el("div", "condition-head");
    head.append(el("span", "condition-name", c.name), el("span", "likelihood", `${capitalize(c.likelihood)} likelihood`));
    li.append(head, el("p", "", c.explanation), el("p", "next", `Next step: ${c.nextSteps}`));
    list.append(li);
  }
  if (analysis.conditions.length === 0) {
    list.append(el("li", "condition", "No specific conditions could be suggested. Consider speaking to a doctor."));
  }

  fillList(card.querySelector(".tips ul"), analysis.selfCareTips);
  fillList(card.querySelector(".seek ul"), analysis.seekCareIf);
  fillList(card.querySelector(".questions ul"), analysis.followUpQuestions);
  return card;
}

function showError(id, message) {
  const box = $(id);
  box.textContent = message ?? "";
  box.hidden = !message;
}

// ---------- Check view ----------

async function onSubmit(event) {
  event.preventDefault();
  const symptoms = $("symptoms").value;
  const error = validateSymptoms(symptoms);
  setFieldError(error);
  if (error) {
    $("symptoms").focus();
    return;
  }

  const body = { symptoms: symptoms.trim() };
  const age = $("age").value;
  if (age !== "") body.age = Number(age);
  if ($("sex").value) body.sex = $("sex").value;

  showError("request-error", null);
  $("result").replaceChildren();
  $("loading").hidden = false;
  $("submit-btn").disabled = true;
  try {
    const record = await api("/diagnoses", { method: "POST", body });
    $("result").replaceChildren(renderResult(record));
  } catch (err) {
    const redFlags = err.details?.redFlags;
    showError(
      "request-error",
      redFlags?.length
        ? `${err.message} Important: your description mentions ${redFlags.join(", ")}. If this is happening now, call your local emergency number.`
        : err.message,
    );
  } finally {
    $("loading").hidden = true;
    $("submit-btn").disabled = false;
  }
}

function updateCount() {
  const length = $("symptoms").value.length;
  $("symptoms-count").textContent = `${length} / ${MAX_LENGTH}`;
  // Clear a stale error as soon as the input becomes valid.
  if ($("symptoms").getAttribute("aria-invalid") === "true" && !validateSymptoms($("symptoms").value)) {
    setFieldError(null);
  }
}

// ---------- History view ----------

async function loadHistory() {
  const list = $("history-list");
  $("clear-confirm").hidden = true;
  showError("history-error", null);
  list.replaceChildren(el("li", "empty", "Loading…"));
  try {
    const { items } = await api("/history");
    if (items.length === 0) {
      list.replaceChildren(el("li", "empty", "No checks yet. Your submissions will appear here."));
      $("clear-history").hidden = true;
      return;
    }
    $("clear-history").hidden = false;
    list.replaceChildren(...items.map(renderHistoryItem));
  } catch (err) {
    list.replaceChildren();
    showError("history-error", err.message);
  }
}

function renderHistoryItem(record) {
  const li = el("li", "history-item");
  const button = el("button");
  button.type = "button";
  button.setAttribute("aria-expanded", "false");

  const top = el("div", "history-top");
  const when = new Date(record.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const badge = el("span", `badge ${record.analysis.urgency}`, URGENCY_LABELS[record.analysis.urgency]);
  top.append(el("time", "", when), badge);
  top.querySelector("time").dateTime = record.createdAt;

  const names = record.analysis.conditions.map((c) => c.name).join(" · ") || "No specific conditions";
  button.append(top, el("p", "history-symptoms", record.input.symptoms), el("p", "history-conditions", names));

  let detail = null;
  button.addEventListener("click", () => {
    if (detail) {
      detail.remove();
      detail = null;
      button.setAttribute("aria-expanded", "false");
    } else {
      detail = renderResult(record);
      li.append(detail);
      button.setAttribute("aria-expanded", "true");
    }
  });
  li.append(button);
  return li;
}

// An in-page confirmation instead of window.confirm(): native dialogs are
// suppressed in some embedded/in-app browsers, which made the button a no-op.
function showClearConfirm(show) {
  $("clear-confirm").hidden = !show;
  $("clear-history").hidden = show;
  if (show) $("clear-cancel").focus();
}

async function clearHistory() {
  $("clear-confirm-btn").disabled = true;
  try {
    await api("/history", { method: "DELETE" });
    showClearConfirm(false);
    await loadHistory();
  } catch (err) {
    showError("history-error", err.message);
  } finally {
    $("clear-confirm-btn").disabled = false;
  }
}

// ---------- Routing ----------

function route() {
  const view = location.hash === "#/history" ? "history" : "check";
  $("view-check").hidden = view !== "check";
  $("view-history").hidden = view !== "history";
  for (const link of document.querySelectorAll("nav a")) {
    if (link.dataset.route === view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (view === "history") loadHistory();
}

// ---------- Boot ----------

function init() {
  $("symptom-form").addEventListener("submit", onSubmit);
  $("symptoms").addEventListener("input", updateCount);
  $("clear-history").addEventListener("click", () => showClearConfirm(true));
  $("clear-cancel").addEventListener("click", () => {
    showClearConfirm(false);
    $("clear-history").focus();
  });
  $("clear-confirm-btn").addEventListener("click", clearHistory);
  window.addEventListener("hashchange", route);
  route();

  api("/health")
    .then((h) => { $("demo-banner").hidden = h.mode !== "mock"; })
    .catch(() => {});
}

init();
