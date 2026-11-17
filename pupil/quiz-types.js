/* Render public question payloads only. All actual marks come from the server. */
(function () {
  "use strict";
  const element = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  let host = null,
    read = () => null;
  const choiceTypes = ["multiple_choice", "spot_the_mistake", "cause_consequence", "select_all"];
  function render(container, q, changed, allowed) {
    host = container;
    host.replaceChildren();
    host.setAttribute("role", "group");
    host.setAttribute("aria-label", "Your answer");
    host.classList.toggle("mixed-answer", !choiceTypes.includes(q.type));
    const notify = () => {
      if (allowed()) changed(read());
    };
    if (choiceTypes.includes(q.type)) {
      const inputs = [];
      const multiple = q.type === "select_all";
      if (multiple) host.append(element("p", "Select " + q.selection_limit + " options."));
      for (const o of q.options) {
        const label = element("label"),
          input = element("input");
        label.className = "option typed-option";
        input.type = multiple ? "checkbox" : "radio";
        input.name = "pupil-option";
        input.value = o.id;
        inputs.push(input);
        input.onchange = () => {
          if (!allowed()) return;
          if (multiple) {
            const count = inputs.filter((i) => i.checked).length;
            inputs.forEach((i) => (i.disabled = !i.checked && count >= q.selection_limit));
          }
          notify();
        };
        label.append(input, element("span", o.text));
        host.append(label);
      }
      read = () => {
        const selected = inputs.filter((i) => i.checked).map((i) => i.value);
        return selected.length ? selected : null;
      };
    } else if (["missing_word", "who_am_i"].includes(q.type)) {
      if (q.clues)
        q.clues.forEach((c, i) => host.append(element("p", "Clue " + (i + 1) + ": " + c)));
      const label = element("label", "Type your answer"),
        input = element("input");
      input.type = "text";
      input.maxLength = 4000;
      input.autocomplete = "off";
      input.className = "typed-answer";
      input.oninput = notify;
      label.append(input);
      host.append(label);
      read = () => (input.value.trim() ? input.value : null);
    } else if (q.type === "matching") {
      const selects = [];
      for (const left of q.left) {
        const label = element("label", left.text),
          select = element("select");
        select.setAttribute("aria-label", left.text);
        select.className = "typed-answer";
        const empty = element("option", "Choose a match");
        empty.value = "";
        select.append(empty);
        for (const right of q.right) {
          const o = element("option", right.text);
          o.value = right.id;
          select.append(o);
        }
        select.onchange = notify;
        label.append(select);
        host.append(label);
        selects.push([left.id, select]);
      }
      read = () =>
        selects.every(([, s]) => s.value)
          ? Object.fromEntries(selects.map(([id, s]) => [id, s.value]))
          : null;
    } else if (q.type === "chronology") {
      let events = [...q.events];
      host.append(element("p", "Arrange these events from earliest to latest."));
      const list = element("div");
      host.append(list);
      function draw() {
        list.replaceChildren();
        events.forEach((event, i) => {
          const row = element("div"),
            label = element("span", event.text);
          row.className = "chronology-event";
          row.append(label);
          for (const [name, d] of [
            ["Move earlier", -1],
            ["Move later", 1],
          ]) {
            const b = element("button", name);
            b.type = "button";
            b.className = "btn btn-soft";
            b.disabled = i + d < 0 || i + d >= events.length;
            b.setAttribute("aria-label", name + ": " + event.text);
            b.onclick = () => {
              if (!allowed()) return;
              [events[i], events[i + d]] = [events[i + d], events[i]];
              draw();
              const target = list.children[i + d].querySelectorAll("button")[d < 0 ? 0 : 1];
              target.focus();
              notify();
            };
            row.append(b);
          }
          list.append(row);
        });
      }
      read = () => events.map((e) => e.id);
      draw();
      changed(read());
    } else throw new Error("Unsupported question type");
  }
  function disable() {
    host?.querySelectorAll("input,select,button").forEach((i) => (i.disabled = true));
  }
  function correctText(q) {
    if (q.answers) return q.answers.canonical;
    if (q.pairs) return q.pairs.map((p) => p.left + " → " + p.right).join("; ");
    const entries = q.events || q.options || [];
    return (q.correct || [])
      .map((id) => entries.find((o) => o.id === id)?.text || "Unavailable")
      .join(q.events ? " → " : "; ");
  }
  function reviewText(row) {
    const q = row.question,
      a = row.your_answer;
    if (a === null) return "No answer / timed out";
    if (q.answers) return String(a);
    if (q.pairs)
      return q.pairs
        .map(
          (p) => p.left + " → " + (q.pairs.find((v) => v.id === a[p.id])?.right || "Not answered"),
        )
        .join("; ");
    if (Array.isArray(q.options) && typeof q.options[0] === "string")
      return "Selected answer index: " + a;
    return correctText({ ...q, correct: a });
  }
  function clear() {
    host?.replaceChildren();
    host = null;
    read = () => null;
  }
  window.PUPIL_TYPES = Object.freeze({ render, disable, correctText, reviewText, clear });
})();
