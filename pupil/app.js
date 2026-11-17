"use strict";
const { supabaseUrl: SUPABASE_URL, publishableKey: SUPABASE_KEY } = window.HISTORY_CONFIG;
const $ = (id) => document.getElementById(id);
const PUPIL_V3 = SUPABASE_URL === "https://ohkpvuhzvshjglbqyepq.supabase.co";
const linkedQuiz = PUPIL_V3 ? new URLSearchParams(location.search).get("quiz") : null;
let pupilEpoch = 0;
let homeFingerprint = "";
const screens = [
  "login",
  "loading",
  "home",
  "instructions",
  "resume",
  "question",
  "result",
  "offline",
  "review",
];
let code = "",
  homework = null,
  attempt = null,
  current = null,
  selected = null,
  busy = false,
  answered = false,
  seconds = 0,
  deadline = 0,
  timer = null,
  lastFeedback = null,
  exitModal = false,
  timeoutPending = false,
  activeScreen = "login",
  finishPending = false;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
function show(id) {
  activeScreen = id;
  screens.forEach((s) => $(s).classList.toggle("hidden", s !== id));
  const heading = $(id).querySelector("h2, h3");
  if (heading) {
    heading.tabIndex = -1;
    heading.focus();
  }
  window.scrollTo(0, 0);
}
function stopTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
function clock(n) {
  const value = Math.max(0, Math.ceil(Number(n) || 0));
  return (
    String(Math.floor(value / 60)).padStart(2, "0") + ":" + String(value % 60).padStart(2, "0")
  );
}
function unwrap(v) {
  return Array.isArray(v) ? v[0] : v;
}
async function rpc(name, params) {
  const requestEpoch = pupilEpoch;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + SUPABASE_KEY,
      "Content-Type": "application/json",
      "Accept-Profile": "homework_api",
      "Content-Profile": "homework_api",
    },
    body: JSON.stringify(params),
  });
  const body = await response.text();
  if (requestEpoch !== pupilEpoch) {
    const e = new Error("Code session changed");
    e.sessionChanged = true;
    throw e;
  }
  let data;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = body;
  }
  if (!response.ok) {
    const e = new Error(data?.message || data?.hint || "Could not connect to homework service");
    e.status = response.status;
    e.retryAfter = Number(response.headers.get("Retry-After") || 10);
    throw e;
  }
  return unwrap(data);
}
const api = {
  home: (c) =>
    PUPIL_V3
      ? linkedQuiz
        ? rpc("quiz_session", { action: "home", payload: { code: c, quiz_id: linkedQuiz } })
        : rpc("quiz_session", { action: "list", payload: { code: c } })
      : rpc("get_current_pupil_homework", { entered_code: c }),
  timing: (c, id) => rpc("get_pupil_quiz_timing", { entered_code: c, entered_quiz_id: id }),
  start: (c, id) =>
    PUPIL_V3
      ? rpc("quiz_session", { action: "start", payload: { code: c, quiz_id: id } })
      : rpc("start_pupil_quiz", { entered_code: c, entered_quiz_id: id }),
  open: (a) =>
    PUPIL_V3
      ? rpc("quiz_session", { action: "open", payload: { attempt_id: a.id, token: a.token } })
      : rpc("open_pupil_question", { entered_attempt_id: a.id, entered_attempt_token: a.token }),
  answer: (a, n) =>
    PUPIL_V3
      ? rpc("quiz_session", {
          action: "answer",
          payload: { attempt_id: a.id, token: a.token, answer: n },
        })
      : rpc("submit_pupil_answer", {
          entered_attempt_id: a.id,
          entered_attempt_token: a.token,
          entered_answer: n,
        }),
  finish: (a) =>
    PUPIL_V3
      ? rpc("quiz_session", { action: "finish", payload: { attempt_id: a.id, token: a.token } })
      : rpc("complete_pupil_quiz", { entered_attempt_id: a.id, entered_attempt_token: a.token }),
  review: (a) =>
    rpc("quiz_session", { action: "review", payload: { attempt_id: a.id, token: a.token } }),
};
function connectionError(err) {
  if (err.sessionChanged) return;
  $("offlineMessage").textContent = attempt
    ? "Your confirmed answers are saved. The server timer continues while you are disconnected."
    : "Homework could not be loaded. Please reconnect and try again.";
  closeExit(false);
  stopTimer();
  $("offlineDetail").textContent =
    "Please try reconnecting. If the problem continues, tell your History teacher.";
  show("offline");
}
function codeRateError(e) {
  if (e.status !== 429) return false;
  stopTimer();
  show("login");
  $("loginError").textContent =
    `Too many code attempts. Please wait ${Math.max(1, Math.ceil(e.retryAfter || 10))} seconds and try again.`;
  return true;
}
function stats() {
  return Number(homework?.total_questions || 25);
}
async function selectHomework(h) {
  homework = h;
  const timing = PUPIL_V3 ? h : await api.timing(code, h.quiz_id);
  if (
    !Array.isArray(timing?.time_limits) ||
    !timing.time_limits.length ||
    !timing.time_limits.every((t) => Number(t.seconds) > 0 && Number(t.questions) > 0)
  )
    throw Error("Question timing is unavailable");
  $("instructionTiming").textContent =
    timing.time_limits
      .map(
        (t) =>
          `${t.questions} ${Number(t.questions) === 1 ? "question" : "questions"}: ${clock(t.seconds)} each`,
      )
      .join("; ") + ". The timer starts when each question opens.";
  const total = Number(h.total_questions || 25),
    threshold = Number(h.pass_mark),
    pass = Math.round((threshold / total) * 100);
  $("howPass").textContent = `${pass}% to pass`;
  $("howThreshold").textContent = `You need ${threshold} out of ${total} correct.`;
  $("howQuestions").textContent = `${total} questions`;
  $("instructionDetails").textContent = `${total} questions in total.`;
  $("instructionPass").textContent = `${pass}% to pass (${threshold} out of ${total}).`;
  $("quizTitle").textContent = `Quiz: ${h.quiz_title}`;
}
function homeworkCard(h, wrap, ribbon) {
  const total = Number(h.total_questions || 25),
    threshold = Number(h.pass_mark),
    pass = Math.round((threshold / total) * 100),
    tries = Number(h.attempts_taken || 0),
    best = h.highest_score;
  const due = h.due_at ? new Date(h.due_at) : null,
    overdue = due && !h.passed && Date.now() > due.getTime();
  const status = h.passed
    ? ["green", "Passed"]
    : h.unfinished_attempt_id
      ? ["blue", "In progress"]
      : tries
        ? ["amber", "Completed but not passed"]
        : ["grey", "Not started"];
  const div = document.createElement("div");
  div.className = "homework-group" + (h.passed ? " complete-group" : "");
  div.innerHTML = [
    `<div class="ribbon">${esc(ribbon || (h.passed ? "COMPLETED HOMEWORK" : "CURRENT HOMEWORK"))}</div>`,
    `<article class="homework-card"><h2>${esc(h.quiz_title)}</h2>`,
    `<div class="stats"><span>▤ &nbsp;${total} questions</span>`,
    `<span>◉ &nbsp;${threshold}/${total} (${pass}%) to pass</span></div>`,
    due
      ? `<div class="due">▣ &nbsp;Due by: ${esc(due.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long" }))}${overdue ? '<span class="overdue">Overdue</span>' : ""}</div>`
      : "",
    `<div class="card-bottom"><span class="status status-${status[0]}">${status[1]}</span></div>`,
    `<div class="homework-extra"><span>Attempts: <b>${tries}</b></span>`,
    `<span>Highest score: <b>${best == null ? "Not attempted" : esc(best) + "/" + total}</b></span></div>`,
    `<div class="homework-extra"><span>WEEK ${esc(h.week_number ?? "—")} · ${esc(h.class_name)}</span>`,
    h.topic ? `<span>${esc(h.topic)}</span>` : "",
    `</div></article>`,
  ].join("");
  const btn = document.createElement("button");
  btn.className = "btn btn-primary";
  btn.disabled = Boolean(h.passed) && !PUPIL_V3;
  btn.textContent =
    h.passed && !PUPIL_V3
      ? "Homework completed"
      : h.unfinished_attempt_id
        ? "Continue Homework"
        : tries
          ? "Try Again"
          : "Start Homework";
  btn.onclick = async () => {
    try {
      await selectHomework(h);
    } catch (e) {
      connectionError(e);
      return;
    }
    if (h.unfinished_attempt_id) {
      $("resumeProgress").textContent =
        "Your answers have been saved. Continue from where you stopped.";
      show("resume");
    } else {
      $("instructionTitle").textContent = h.quiz_title;
      show("instructions");
    }
  };
  div.querySelector(".card-bottom").append(btn);
  wrap.append(div);
  if (PUPIL_V3 && h.first_passed_at) {
    const summary = document.createElement("p");
    summary.textContent =
      "First passed: " +
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(h.first_passed_at)) +
      " · " +
      h.deadline_status;
    div.append(summary);
  }
}
async function loadHome({ quiet = false } = {}) {
  timeoutPending = false;
  stopTimer();
  if (!quiet) show("loading");
  try {
    const h = await api.home(code);
    if (!h?.valid_code) {
      code = "";
      show("login");
      $("loginError").textContent = "Code not recognised. Check your code and try again.";
      return;
    }
    const fingerprint = JSON.stringify(h);
    if (quiet && fingerprint === homeFingerprint) return;
    homeFingerprint = fingerprint;
    const previousOpen = Boolean($("homeContent").querySelector("details[open]"));
    attempt = null;
    current = null;
    $("yearBadge").textContent = "Year " + h.year_group;
    const wrap = $("homeContent");
    wrap.replaceChildren();
    const quizzes =
      PUPIL_V3 && !linkedQuiz && Array.isArray(h.quizzes) ? h.quizzes : h.quiz_id ? [h] : [];
    homework = quizzes[0] || null;
    if (!quizzes.length) {
      if (linkedQuiz)
        wrap.textContent =
          "This quiz is not available for your class yet. Check the ClassCharts link and release time.";
      else
        wrap.innerHTML =
          "<h3>You're all caught up!</h3><p>There is no History homework available at the moment.</p>";
      show("home");
      return;
    }
    await selectHomework(quizzes[0]);
    homeworkCard(quizzes[0], wrap, PUPIL_V3 && !linkedQuiz ? "CURRENT HOMEWORK" : null);
    if (quizzes.length > 1) {
      const previous = document.createElement("details"),
        summary = document.createElement("summary");
      previous.className = "previous-quizzes";
      previous.open = previousOpen;
      summary.textContent = "Previous Quizzes (" + (quizzes.length - 1) + ")";
      previous.append(summary);
      for (const quiz of quizzes.slice(1)) homeworkCard(quiz, previous, "PREVIOUS QUIZ");
      wrap.append(previous);
    }
    show("home");
  } catch (e) {
    if (PUPIL_V3 && e.message === "invalid_quiz_link") {
      homework = null;
      attempt = null;
      current = null;
      $("homeContent").textContent =
        "This ClassCharts link is not valid. Ask your teacher for the correct quiz link.";
      show("home");
      return;
    }
    if (!codeRateError(e)) connectionError(e);
  }
}
$("loginForm").onsubmit = async (e) => {
  e.preventDefault();
  pupilEpoch++;
  code = $("code").value.trim().toUpperCase();
  $("loginError").textContent = "";
  if (code) await loadHome();
};
$("changeCode").onclick = () => {
  pupilEpoch++;
  $("reviewContent").replaceChildren();
  window.PUPIL_TYPES.clear();
  $("feedback").replaceChildren();
  current = null;
  selected = null;
  lastFeedback = null;
  stopTimer();
  code = "";
  homework = null;
  attempt = null;
  $("code").value = "";
  homeFingerprint = "";
  $("homeContent").replaceChildren();
  show("login");
};
$("backFromInstructions").onclick = () => loadHome();
$("resumeBack").onclick = () => loadHome();
async function start() {
  if (busy) return;
  busy = true;
  show("loading");
  try {
    finishPending = false;
    const a = await api.start(code, homework.quiz_id);
    if (!a?.attempt_id || !a?.attempt_token) throw Error("No quiz session returned");
    attempt = { id: a.attempt_id, token: a.attempt_token };
    await openQuestion();
  } catch (e) {
    if (!codeRateError(e)) connectionError(e);
  } finally {
    busy = false;
    flushTimeout();
  }
}
$("startQuiz").onclick = start;
$("resumeQuiz").onclick = start;
async function openQuestion() {
  timeoutPending = false;
  stopTimer();
  show("loading");
  let q;
  try {
    q = await api.open(attempt);
  } catch (error) {
    if (error.message === "All questions answered; complete the quiz") return finish();
    throw error;
  }
  if (!q || (!q.payload && (!Array.isArray(q.answer_options) || q.answer_options.length !== 4)))
    throw Error("Invalid question response");
  current = {
    number: Number(q.question_number),
    text: q.question_text,
    options: q.answer_options,
    limit: Number(q.time_allowed_seconds),
    payload: q.payload || null,
  };
  selected = null;
  answered = false;
  lastFeedback = null;
  $("qNumber").textContent = `Question ${current.number} of ${stats()}`;
  $("progressBar").style.width = ((current.number - 1) / stats()) * 100 + "%";
  $("questionText").textContent = current.text;
  $("questionTiming").textContent = `Time allowed for this question: ${clock(current.limit)}.`;
  $("questionError").textContent = "";
  $("feedback").className = "feedback inline-feedback hidden";
  $("submitAnswer").classList.remove("hidden");
  $("submitAnswer").disabled = true;
  $("nextQuestion").classList.add("hidden");
  const options = $("options");
  options.replaceChildren();
  options.classList.remove("mixed-answer");
  if (!current.payload) options.setAttribute("role", "radiogroup");
  if (current.payload)
    window.PUPIL_TYPES.render(
      options,
      current.payload,
      (value) => {
        selected = value;
        $("submitAnswer").disabled = value === null;
      },
      () => !answered && !busy,
    );
  else
    current.options.forEach((value, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "option";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", "false");
      b.tabIndex = i === 0 ? 0 : -1;
      b.innerHTML =
        '<span class="circle" aria-hidden="true"></span><span>' + esc(value) + "</span>";
      b.onclick = () => {
        if (answered || busy) return;
        selected = i;
        options.querySelectorAll("button").forEach((el) => {
          el.classList.remove("selected");
          el.setAttribute("aria-checked", "false");
          el.tabIndex = -1;
        });
        b.classList.add("selected");
        b.setAttribute("aria-checked", "true");
        b.tabIndex = 0;
        $("submitAnswer").disabled = false;
      };
      b.onkeydown = (event) => {
        const directions = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        if (answered || busy || !(event.key in directions)) return;
        event.preventDefault();
        const target =
          options.children[
            (i + directions[event.key] + current.options.length) % current.options.length
          ];
        target.focus();
        target.click();
      };
      options.append(b);
    });
  seconds = Math.max(0, Number(q.seconds_remaining));
  show("question");
  runTimer();
}
// Queue an expired question until start/next releases the shared request guard.
function flushTimeout() {
  if (!timeoutPending || busy || answered || $("question").classList.contains("hidden")) return;
  timeoutPending = false;
  void submit(true);
}
function updateTimer() {
  seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  $("timer").textContent = clock(seconds);
  if (seconds === 0) {
    stopTimer();
    timeoutPending = true;
    flushTimeout();
  }
}
function runTimer() {
  stopTimer();
  deadline = Date.now() + seconds * 1000;
  updateTimer();
  if (seconds > 0) timer = setInterval(updateTimer, 200);
}
$("submitAnswer").onclick = () => submit(false);
async function submit(timedOut) {
  if (busy || answered || (!timedOut && selected === null)) return;
  busy = true;
  stopTimer();
  $("submitAnswer").disabled = true;
  if (current.payload) window.PUPIL_TYPES.disable();
  $("questionError").textContent = "Saving your answer…";
  try {
    const r = await api.answer(attempt, timedOut ? null : selected);
    if (typeof r?.answer_correct !== "boolean") throw Error("Missing marking response");
    answered = true;
    $("options")
      .querySelectorAll("button")
      .forEach((b) => {
        b.disabled = true;
      });
    updateExitProgress();
    lastFeedback = r;
    const correctIndex = Number(r.correct_option),
      correctText = current.payload
        ? window.PUPIL_TYPES.correctText(r.correct_answer)
        : (current.options[correctIndex] ?? "Unavailable");
    $("feedback").className =
      "feedback inline-feedback " + (r.answer_correct ? "correct" : "wrong");
    $("feedback").innerHTML = [
      `<span class="feedback-tick" aria-hidden="true">${r.answer_correct ? "✓" : "×"}</span><div class="feedback-copy"><strong>${timedOut || r.timed_out ? "Time is up" : r.answer_correct ? "Correct!" : "Not quite"}</strong>`,
      `<p>Correct answer: ${esc(correctText)}</p>`,
      `<p>${esc(r.feedback || "Review this fact before moving on.")}</p></div>`,
    ].join("");
    $("questionError").textContent = "";
    $("submitAnswer").classList.add("hidden");
    $("nextQuestion").classList.remove("hidden");
    $("nextQuestion").textContent = current.number >= stats() ? "See Your Result" : "Next Question";
    if (!exitModal) $("nextQuestion").focus();
  } catch (e) {
    if (!codeRateError(e)) connectionError(e);
  } finally {
    busy = false;
    flushTimeout();
  }
}
$("nextQuestion").onclick = async () => {
  if (busy) return;
  busy = true;
  try {
    if (current.number >= stats()) await finish();
    else await openQuestion();
  } catch (e) {
    if (!codeRateError(e)) connectionError(e);
  } finally {
    busy = false;
    flushTimeout();
  }
};
async function finish() {
  finishPending = true;
  stopTimer();
  show("loading");
  const r = await api.finish(attempt);
  const total = Number(r.total_questions),
    score = Number(r.final_score),
    passed = Boolean(r.passed);
  if (!Number.isFinite(score) || !Number.isFinite(total)) throw Error("Invalid result");
  finishPending = false;
  $("resultHero").className = "result-hero " + (passed ? "success" : "fail");
  $("resultCheck").hidden = !passed;
  $("resultIcon").textContent = passed ? "🏆" : "✖";
  $("resultHeading").textContent = passed ? "You passed!" : "Not passed yet.";
  $("resultScore").textContent = score + " / " + total;
  $("resultPercent").className = "percent " + (passed ? "success-percent" : "fail-percent");
  const threshold = Number(homework.pass_mark),
    pass = Math.round((threshold / total) * 100);
  $("resultThreshold").textContent = passed
    ? `✓ You met the pass mark (${pass}%).`
    : `✓ You need ${pass}% to pass (${threshold} out of ${total}).`;
  $("resultPercent").textContent = Math.round((score / total) * 100) + "%";
  $("resultAttempts").textContent = passed ? "✓ Well done!" : "✓ Result saved.";
  $("resultMessage").textContent = passed
    ? "Your result has been saved for your teacher."
    : "You can try again to reach the pass mark.";
  $("resultAction").textContent = passed ? "⌂ Back to homework" : "⟳ Retry quiz →";
  $("resultAction").onclick = async () => {
    if (passed && !PUPIL_V3) await loadHome();
    else {
      await loadHome();
      $("instructionTitle").textContent = homework.quiz_title;
      show("instructions");
    }
  };
  if (PUPIL_V3) $("resultAction").textContent = "⟳ Retry quiz →";
  $("reviewAnswers").classList.toggle("hidden", !PUPIL_V3);
  show("result");
}
$("reviewAnswers").onclick = async () => {
  if (!attempt || busy) return;
  busy = true;
  $("reviewError").textContent = "Loading saved answers…";
  $("reviewContent").replaceChildren();
  show("review");
  try {
    const reference = attempt;
    const result = await api.review(reference);
    if (attempt?.id !== reference.id || attempt?.token !== reference.token) return;
    for (const row of result.answers || []) {
      const box = document.createElement("article");
      box.className = "answer-review";
      const heading = document.createElement("h3");
      heading.textContent = row.number + ". " + row.prompt;
      box.append(heading);
      for (const clue of row.question?.clues || []) {
        const p = document.createElement("p");
        p.textContent = clue;
        box.append(p);
      }
      for (const text of [
        "Your answer: " + (row.your_answer_text ?? window.PUPIL_TYPES.reviewText(row)),
        row.timed_out ? "Time expired — not scored" : row.correct ? "Correct" : "Not correct",
        "Correct answer: " +
          (typeof row.correct_answer === "string"
            ? row.correct_answer
            : window.PUPIL_TYPES.correctText(row.correct_answer)),
        row.explanation,
      ]) {
        const p = document.createElement("p");
        p.textContent = text;
        box.append(p);
      }
      $("reviewContent").append(box);
    }
    $("reviewError").textContent = "Your saved answers and server-marked results.";
  } catch {
    $("reviewError").textContent =
      "Could not load your answer review. Check your connection and try Review my answers again.";
  } finally {
    busy = false;
  }
};
$("reviewBack").onclick = () => show("result");
$("reviewRetry").onclick = () => $("resultAction").click();
function updateExitProgress() {
  if (!current) return;
  const saved = answered ? current.number : current.number - 1;
  $("exitProgress").textContent =
    saved === 0
      ? "No answers have been confirmed yet. Your question timer continues while this dialog is open."
      : `Your confirmed answers through Question ${saved} are saved. Your question timer continues while this dialog is open.`;
}
function closeExit(restore = true) {
  if (!exitModal) return;
  $("overlay").classList.add("hidden");
  document.querySelector("main").inert = false;
  document.querySelector("header").inert = false;
  exitModal = false;
  if (restore && activeScreen === "question") $("exitQuiz").focus();
}
$("exitQuiz").onclick = () => {
  exitModal = true;
  updateExitProgress();
  $("overlay").classList.remove("hidden");
  document.querySelector("main").inert = true;
  document.querySelector("header").inert = true;
  $("stay").focus();
};
$("stay").onclick = () => {
  closeExit();
  if (!answered) updateTimer();
};
$("overlay").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    $("stay").click();
  } else if (event.key === "Tab") {
    const first = $("stay"),
      last = $("saveExit");
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});
$("saveExit").onclick = async () => {
  closeExit(false);
  stopTimer();
  await loadHome();
};
$("retryConnection").onclick = async () => {
  if (busy) return;
  if (!code) {
    show("login");
    return;
  }
  busy = true;
  try {
    if (attempt && finishPending) {
      try {
        await finish();
      } catch (error) {
        // The server may have committed completion before its response was lost.
        if (error.message !== "Invalid or completed attempt") throw error;
        await loadHome();
      }
    } else if (attempt) {
      const a = await api.start(code, homework.quiz_id);
      if (!a?.attempt_id || !a?.attempt_token) {
        await loadHome();
        return;
      }
      attempt = { id: a.attempt_id, token: a.attempt_token };
      await openQuestion();
    } else await loadHome();
  } catch (error) {
    if (!codeRateError(error)) connectionError(error);
  } finally {
    busy = false;
    flushTimeout();
  }
};
window.addEventListener("offline", () => {
  if (attempt && activeScreen === "question") connectionError(Error("Offline"));
  else $("status").textContent = "You are offline. Reconnect before loading homework.";
});
window.addEventListener("online", () => {
  $("status").textContent = "Connection restored.";
});

// Refresh only the idle permanent homepage; never interrupt an attempt or reveal future metadata.
function refreshHomeworkList() {
  if (PUPIL_V3 && !linkedQuiz && code && activeScreen === "home" && !busy && !document.hidden)
    loadHome({ quiet: true });
}
setInterval(refreshHomeworkList, 60000);
document.addEventListener("visibilitychange", refreshHomeworkList);
