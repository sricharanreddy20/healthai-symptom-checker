// HealthAI front end: no framework, no build step. All patient-provided and
// model-provided text is rendered with textContent, never innerHTML.

const MIN_LENGTH = 10; // keep in sync with app/domain/schemas.py
const MAX_LENGTH = 1000;
const REQUEST_TIMEOUT_MS = 90_000;
const THINKING_STEPS = [
  "Reading your symptoms…",
  "Considering possible causes…",
  "Weighing how urgent this is…",
  "Writing up next steps…",
];

const URGENCY_LABELS = {
  self_care: "Self-care",
  see_doctor: "See a doctor",
  urgent_care: "Urgent care today",
  emergency: "Emergency",
};
const SEX_LABELS = { female: "Female", male: "Male", other: "Other" };

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
  $("symptom-form").classList.toggle("has-error", Boolean(message));
}

// ---------- Rendering helpers ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(pathData) {
  const ns = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(ns, "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", pathData);
  icon.append(path);
  return icon;
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function fillList(ul, items) {
  ul.replaceChildren(...items.map((item) => el("li", "", item)));
}

function cloneTemplate(id) {
  return $(id).content.firstElementChild.cloneNode(true);
}

function renderAnswer(record) {
  const { analysis, redFlags, meta } = record;
  const card = cloneTemplate("result-template");

  if (redFlags.length > 0 || analysis.urgency === "emergency") {
    const box = card.querySelector(".er-banner");
    box.hidden = false;
    box.querySelector(".emergency-text").textContent = redFlags.length
      ? `Your description mentions: ${redFlags.join(", ").toLowerCase()}. Call your local emergency number.`
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
    const likelihood = el("span", "likelihood");
    const meter = el("span", `meter l-${c.likelihood}`);
    meter.setAttribute("aria-hidden", "true");
    meter.append(el("i"), el("i"), el("i"));
    likelihood.append(meter, `${capitalize(c.likelihood)} likelihood`);
    head.append(el("span", "condition-name", c.name), likelihood);

    const next = el("p", "next");
    next.append(svg("M5 12h14M13 6l6 6-6 6"), el("span", "", c.nextSteps));
    li.append(head, el("p", "", c.explanation), next);
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

function describeContext({ age, sex }) {
  return [age !== undefined ? `Age ${age}` : null, sex ? SEX_LABELS[sex] : null].filter(Boolean).join(" · ");
}

// ---------- Check view: conversation thread ----------

function appendUserTurn(body) {
  const turn = cloneTemplate("user-turn-template");
  turn.querySelector(".bubble").textContent = body.symptoms;
  turn.querySelector(".bubble-meta").textContent = describeContext(body);
  $("thread").append(turn);
}

function appendThinkingTurn() {
  const turn = cloneTemplate("thinking-template");
  const text = turn.querySelector(".thinking-text");
  let step = 0;
  const timer = setInterval(() => {
    step = Math.min(step + 1, THINKING_STEPS.length - 1);
    text.textContent = THINKING_STEPS[step];
  }, 2200);
  $("thread").append(turn);
  turn.scrollIntoView({ behavior: "smooth", block: "end" });
  return {
    replaceWith(content) {
      clearInterval(timer);
      const done = el("li", "turn turn-ai");
      done.append(turn.querySelector(".ai-avatar").cloneNode(true), content);
      turn.replaceWith(done);
      return done;
    },
  };
}

function errorTurnContent(err) {
  const redFlags = err.details?.redFlags;
  const message = redFlags?.length
    ? `${err.message} Important: your description mentions ${redFlags.join(", ").toLowerCase()}. If this is happening now, call your local emergency number.`
    : err.message;
  return el("p", "turn-error", message);
}

async function onSubmit(event) {
  event.preventDefault();
  const textarea = $("symptoms");
  const error = validateSymptoms(textarea.value);
  setFieldError(error);
  if (error) {
    textarea.focus();
    return;
  }

  const body = { symptoms: textarea.value.trim() };
  if ($("age").value !== "") body.age = Number($("age").value);
  if ($("sex").value) body.sex = $("sex").value;

  $("view-check").classList.remove("is-empty");
  appendUserTurn(body);
  textarea.value = "";
  updateComposer();
  const thinking = appendThinkingTurn();
  $("submit-btn").disabled = true;

  let turn;
  try {
    const record = await api("/diagnoses", { method: "POST", body });
    turn = thinking.replaceWith(renderAnswer(record));
  } catch (err) {
    turn = thinking.replaceWith(errorTurnContent(err));
  } finally {
    $("submit-btn").disabled = false;
    textarea.focus();
  }
  turn.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateComposer() {
  const textarea = $("symptoms");
  // Grow with the content, like a chat input.
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
  $("symptoms-count").textContent = `${textarea.value.length} / ${MAX_LENGTH}`;
  if (textarea.getAttribute("aria-invalid") === "true" && !validateSymptoms(textarea.value)) {
    setFieldError(null);
  }
}

function onComposerKeydown(event) {
  // Enter sends, Shift+Enter adds a new line (ignored while an IME is composing).
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!$("submit-btn").disabled) $("symptom-form").requestSubmit();
  }
}

function onSuggestion(event) {
  const button = event.target.closest(".suggestion");
  if (!button) return;
  $("symptoms").value = button.dataset.text;
  updateComposer();
  $("symptoms").focus();
}

// ---------- History view ----------

function emptyState(message) {
  const li = el("li", "empty");
  li.append(svg("M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"), message);
  return li;
}

async function loadHistory() {
  const list = $("history-list");
  $("clear-confirm").hidden = true;
  showError("history-error", null);
  list.replaceChildren(el("li", "empty", "Loading…"));
  try {
    const { items } = await api("/history");
    if (items.length === 0) {
      list.replaceChildren(emptyState("No checks yet. Your submissions will appear here."));
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
  const time = el("time", "", new Date(record.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
  time.dateTime = record.createdAt;
  const badge = el("span", `badge ${record.analysis.urgency}`, URGENCY_LABELS[record.analysis.urgency]);
  top.append(time, badge);

  const names = record.analysis.conditions.map((c) => c.name).join(" · ") || "No specific conditions";
  button.append(top, el("p", "history-symptoms", record.input.symptoms), el("p", "history-conditions", names));

  let detail = null;
  button.addEventListener("click", () => {
    if (detail) {
      detail.remove();
      detail = null;
      button.setAttribute("aria-expanded", "false");
    } else {
      detail = el("div", "history-detail");
      detail.append(renderAnswer(record));
      li.append(detail);
      button.setAttribute("aria-expanded", "true");
    }
  });
  li.append(button);
  return li;
}

function showError(id, message) {
  const box = $(id);
  box.textContent = message ?? "";
  box.hidden = !message;
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
  for (const link of document.querySelectorAll(".segmented a")) {
    if (link.dataset.route === view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (view === "history") loadHistory();
  else $("symptoms").focus({ preventScroll: true });
}

// ---------- Boot ----------

function init() {
  $("symptom-form").addEventListener("submit", onSubmit);
  $("symptoms").addEventListener("input", updateComposer);
  $("symptoms").addEventListener("keydown", onComposerKeydown);
  $("suggestions").addEventListener("click", onSuggestion);
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
