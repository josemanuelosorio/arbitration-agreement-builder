'use strict';

/* ==============================================================
   Generic questionnaire-to-text engine, v0.3 (born as the
   Arbitration Agreement Builder prototype engine)
   --------------------------------------------------------------
   Implements the Consolidated Specification v1.x (30 Jul 2026).

   The core change against v0.1, demanded by spec §1.3.3: effects
   are now DATA from a closed action set (include_fragment,
   omit_fragment, set_param, show_advisory, none), interpreted by
   a GENERIC engine. There is no per-question code anywhere in
   this file. Adding a question that uses existing input types and
   assembly behaviours is a pure content change to the JSON.

   Placement is separate from order (§1.3.3): a fragment first
   declares WHERE it goes (replaces_base / paragraph_before /
   in_clause / paragraph_after / advisory), then its order among
   peers. This is what lets Variant A sit last and Variant D
   displace the base clause without special cases.

   v0.3 (05.08.2026): the engine now serves a second content model
   unchanged. Two additions, both model-driven:
   1. Numeric condition forms gte / lt. They read a NAMED numeric
      input of a question's answer (condition carries question +
      param). Asymmetry by design: where not_equals passes when
      unanswered, gte/lt FAIL when no numeric value exists; a
      result must never appear before the visitor has given the
      number it depends on.
   2. Model-supplied UI strings (ui_copy.*) override the wording
      this file previously hardcoded; every override falls back to
      the exact previous string, so the arbitration build renders
      byte-identically. Verified against the full golden suite.
   ============================================================== */

const model = JSON.parse(document.getElementById('content_model').textContent);

/* Prototype-only material. Kept deliberately tiny in v0.2. */
const proto = {
  // Draft disclaimer: the final wording needs the site owner's sign-off.
  draft_disclaimer:
    'DRAFT (requires sign-off): This builder is a free information tool. ' +
    'It does not constitute legal advice and creates no attorney-client relationship. It is not affiliated ' +
    'with, or endorsed by, the International Chamber of Commerce. Review the generated clause with counsel ' +
    'before including it in a contract.'
};

const state = {
  screen: 'landing',
  mode: null,
  idx: 0,
  answers: {},         // qid -> { option_id, inputs: { param_name: value } }  (retained even when hidden, §7.1)
  ui_lang: 'en',
  output_lang: 'en',
  changed: new Set()   // sentence keys touched by the last change (underline, §7.2)
};

/* ----------------------- small helpers ----------------------- */

function t(slot) {
  // de: "pending" is the explicit interim marker of spec §1.3.1.
  // German UI falls back to English with a banner, never silently.
  if (!slot) return '';
  if (state.ui_lang === 'de' && slot.de && slot.de !== 'pending') return slot.de;
  return slot.en == null ? '' : slot.en;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function question_by_id(qid) { return model.questions.find(q => q.id === qid); }
function fragment_by_id(fid) { return model.clause_fragments.find(f => f.id === fid); }
function advisory_by_id(aid) { return model.advisories.find(a => a.id === aid); }

function chip_class(status) {
  const s = String(status || '').toLowerCase();
  if (s.startsWith('verified')) return ['icc', 'verified'];   // verified_ris etc., source in the full note
  if (s.includes('settled_spec')) return ['icc', 'settled'];
  if (s.includes('signoff_required')) return ['sign', 'sign-off'];
  if (s.includes('phase2')) return ['para', 'phase 2'];
  if (s.includes('verbatim_icc')) return ['icc', 'verbatim ICC'];
  if (s.includes('assumption')) return ['assum', 'assumption'];
  if (s.includes('tbd')) return ['tbd', 'TBD'];
  return ['assum', 'confirm'];
}

function chip(status) {
  if (!status) return '';
  const [cls, label] = chip_class(status);
  let html = `<span class="chip ${cls}" title="${esc(status)}">${esc(label)}</span>`;
  // A settled+signoff combination never happens; the sign chip doubles as the ⚠ marker.
  if (cls !== 'sign' && /signoff_required|sign-off|requires uk/i.test(status)) {
    html += `<span class="chip sign" title="${esc(status)}">sign-off</span>`;
  }
  return html;
}

/* --------------- conditions (generic evaluator) --------------- */

function answer_id_of(visible_set, qid) {
  // §7.1: answers of hidden questions are retained but leave the
  // output. Visibility is the filter, never deletion.
  if (visible_set && !visible_set.has(qid)) return undefined;
  const a = state.answers[qid];
  return a ? a.option_id : undefined;
}

function answer_input_of(visible_set, qid, param) {
  // Numeric twin of answer_id_of: same §7.1 visibility filter, but
  // reads a named input value instead of the option id.
  if (visible_set && !visible_set.has(qid)) return undefined;
  const a = state.answers[qid];
  const v = a && a.inputs ? a.inputs[param] : undefined;
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

function eval_condition(cond, visible_set) {
  if (!cond) return true;
  if (cond.all_of) return cond.all_of.every(c => eval_condition(c, visible_set));
  if (cond.any_of) return cond.any_of.some(c => eval_condition(c, visible_set));
  if ('gte' in cond || 'lt' in cond) {
    // Numeric forms (engine v0.3). Unlike not_equals, these FAIL
    // when the value is missing: no number, no conclusion.
    const n = answer_input_of(visible_set, cond.question, cond.param);
    if (n === undefined) return false;
    if ('gte' in cond) return n >= cond.gte;
    return n < cond.lt;
  }
  const a = answer_id_of(visible_set, cond.question);
  if ('equals' in cond) return a === cond.equals;
  if ('not_equals' in cond) return a !== cond.not_equals;   // unanswered passes, per §1.3.3 / §4.3.3
  if ('in' in cond) return Array.isArray(cond.in) && cond.in.includes(a);
  if ('answered' in cond) return cond.answered ? a !== undefined : a === undefined;
  return true;
}

/* ------------------- mode flow + visibility ------------------- */

function mode_def() { return model.modes.find(m => m.id === state.mode); }

function mode_override(qid) {
  const m = mode_def();
  return (m && m.overrides && m.overrides[qid]) || null;
}

function options_for(q) {
  const ov = mode_override(q.id);
  if (ov && ov.options_subset) {
    return q.options.filter(o => ov.options_subset.includes(o.id));
  }
  return q.options;
}

function flow_questions() {
  const m = mode_def();
  if (!m) return [];
  const entries = [];
  if (m.question_flow) m.question_flow.forEach(id => entries.push({ id, phase: null }));
  else (m.phases || []).forEach(ph => (ph.questions || []).forEach(id => entries.push({ id, phase: ph })));
  // visible_if is evaluated WITHOUT a visibility filter on the gating
  // answer: gating questions are earlier in the flow and their answers
  // are legitimate inputs even mid-recomputation.
  return entries
    .map(e => ({ q: question_by_id(e.id), phase: e.phase }))
    .filter(e => e.q && eval_condition(e.q.visible_if, null));
}

/* ---------------- generic effect interpretation --------------- */

function resolve_localized_param(name, key) {
  const p = model.parameters[name];
  const lang = 'en';  // de clause output is pending (§7.4); the banner declares it
  if (!p) return null;
  if (key === undefined || key === null) return p.default ? p.default[lang] : null;
  return p.values && p.values[key] ? p.values[key][lang] : null;
}

function compute_assembly() {
  const visible_entries = flow_questions();
  const visible = new Set(visible_entries.map(e => e.q.id));

  const params = {};            // resolved parameter values
  const included = new Set();   // fragment ids via include_fragment
  const omitted = new Set();
  const advisories = [];        // advisory objects to show
  const defaulted = [];         // "I don't know" summary entries (§8 item 6 proposal)
  const delegated = [];

  // Defaults of localized parameters apply before any answer.
  Object.keys(model.parameters).forEach(name => {
    const def = resolve_localized_param(name, null);
    if (def != null) params[name] = def;
  });

  // Interpret the chosen option's effects for every visible answered question.
  visible_entries.forEach(({ q }) => {
    const a = state.answers[q.id];
    if (!a) return;
    const opt = options_for(q).find(o => o.id === a.option_id);
    if (!opt) return;
    (opt.effects || []).forEach(eff => {
      switch (eff.action) {
        case 'set_param': {
          if (eff.from_input) {
            const v = a.inputs ? a.inputs[eff.param] : undefined;
            if (v !== undefined && v !== '') params[eff.param] = v;
          } else if (model.parameters[eff.param] && model.parameters[eff.param].localized) {
            params[eff.param] = resolve_localized_param(eff.param, eff.value);
          } else {
            params[eff.param] = eff.value;
          }
          break;
        }
        case 'include_fragment': included.add(eff.fragment); break;
        case 'omit_fragment': omitted.add(eff.fragment); break;
        case 'show_advisory': {
          const adv = advisory_by_id(eff.advisory);
          if (adv) advisories.push(adv);
          break;
        }
        case 'none': break;
        default: break; // unknown action = schema drift; validator catches it before this runs
      }
    });
    if (opt.summary) {
      const target = opt.summary.type === 'default' ? defaulted : delegated;
      target.push({ topic: t(q.topic_label) || q.id, note: t(opt.summary.note) });
    }
  });

  // Standing fragment conditions (included_if) and the base fragment.
  const active = [];
  model.clause_fragments.forEach(f => {
    let is_in = f.base || included.has(f.id);
    if (f.included_if) is_in = eval_condition(f.included_if, visible);
    if (omitted.has(f.id)) is_in = false;
    if (is_in) active.push(f);
  });

  // Advisories with standing conditions.
  model.advisories.forEach(a => {
    if (a.included_if && eval_condition(a.included_if, visible)) advisories.push(a);
  });

  // Completeness rule of §7.1: a fragment with an unfilled mandatory
  // slot is never emitted. The base clause always has its default.
  const emittable = [];
  const withheld = [];
  active.forEach(f => {
    const text = t_clause(f.text);
    const missing = (text.match(/\{(\w+)\}/g) || [])
      .map(m => m.slice(1, -1))
      .filter(name => params[name] === undefined || params[name] === '' || params[name] === null);
    if (missing.length) withheld.push({ frag: f, missing });
    else emittable.push(f);
  });

  // replaces_base displaces the base clause (§5.3 Variant D).
  const replacer = emittable.find(f => f.placement === 'replaces_base');
  const final_frags = replacer ? emittable.filter(f => !f.base) : emittable;

  // Riders: attach when their own condition holds (§4.3.3).
  const rendered = final_frags.map(f => {
    const sentences = [{ key: f.id, text: fill_params(t_clause(f.text), params), status: f.status, spec_ref: f.spec_ref }];
    (f.riders || []).forEach(r => {
      if (eval_condition(r.condition, visible)) {
        sentences.push({ key: f.id + '/' + r.id, text: fill_params(t_clause(r.text), params), status: r.status, spec_ref: 'rider' });
      }
    });
    return { frag: f, sentences };
  });

  const complete = visible_entries.every(({ q }) => is_answered(q));

  return {
    groups: {
      before: rendered.filter(x => x.frag.placement === 'paragraph_before'),
      clause: rendered.filter(x => x.frag.placement === 'in_clause' || x.frag.placement === 'replaces_base')
                      .sort((a, b) => (a.frag.placement === 'replaces_base' ? -1 : a.frag.order) - (b.frag.placement === 'replaces_base' ? -1 : b.frag.order)),
      after: rendered.filter(x => x.frag.placement === 'paragraph_after')
    },
    advisories, defaulted, delegated, withheld, complete, visible_entries
  };
}

function t_clause(slot) {
  // Clause output language: de is pending across v0.2 (§7.4), so the
  // panel shows an explicit banner and renders English. No silent mix.
  return slot && slot.en != null ? slot.en : '';
}

function fill_params(text, params) {
  return text.replace(/\{(\w+)\}/g, (m, k) => {
    let v = params[k];
    if (v === undefined || v === null || v === '') return m;
    // Lawyers read 3,000,000 faster than 3000000 (§4.2.3).
    if (k === 'threshold_amount' && !isNaN(Number(v))) v = Number(v).toLocaleString('en-US');
    return String(v);
  });
}

/* --------------------- answered / gating ---------------------- */

function is_answered(q) {
  const a = state.answers[q.id];
  if (!a) return false;
  const opt = options_for(q).find(o => o.id === a.option_id);
  if (!opt) return false;
  if (!opt.input) return true;
  // Generic rule: an option that carries an input is answered once
  // every parameter that input feeds has a non-empty value (§1.3.3
  // "option that carries an input" is one pattern, not bespoke cases).
  const param_names = opt.input.params ? Object.values(opt.input.params) : [opt.input.param];
  return param_names.every(p => {
    const v = a.inputs ? a.inputs[p] : undefined;
    return v !== undefined && v !== null && v !== '';
  });
}

/* ------------------------ interactions ------------------------ */

function assembly_keys(asm) {
  const keys = [];
  ['before', 'clause', 'after'].forEach(g => asm.groups[g].forEach(x =>
    x.sentences.forEach(s => keys.push(s.key + '|' + s.text))));
  return keys;
}

function with_change_tracking(mutate) {
  const before = new Set(assembly_keys(compute_assembly()));
  mutate();
  const after = compute_assembly();
  state.changed = new Set(
    assembly_keys(after).filter(k => !before.has(k)).map(k => k.split('|')[0])
  );
}

function pick_option(qid, oid) {
  with_change_tracking(() => {
    const prev = state.answers[qid];
    // §7.1 retention: re-choosing the same option keeps its inputs.
    state.answers[qid] = { option_id: oid, inputs: (prev && prev.option_id === oid && prev.inputs) || (prev && prev.inputs) || {} };
    const q = question_by_id(qid);
    const opt = options_for(q).find(o => o.id === oid);
    // Preselect the first currency so the amount input reacts immediately.
    if (opt && opt.input && opt.input.type === 'amount_currency') {
      const cur_param = opt.input.params.currency;
      if (!state.answers[qid].inputs[cur_param]) state.answers[qid].inputs[cur_param] = opt.input.currencies[0];
    }
  });
  render();
}

function set_input(qid, param, value) {
  with_change_tracking(() => {
    const a = state.answers[qid];
    if (!a) return;
    a.inputs = a.inputs || {};
    a.inputs[param] = value;
  });
  refresh_panel();
  const { entry } = current_entry();
  const btn = document.getElementById('next_btn');
  if (btn && entry) btn.disabled = !is_answered(entry.q);
}

function current_entry() {
  const list = flow_questions();
  if (state.idx >= list.length) state.idx = Math.max(0, list.length - 1);
  return { list, entry: list[state.idx] };
}

function nav(dir) {
  const { list } = current_entry();
  if (dir > 0 && state.idx === list.length - 1) {
    // Completeness gate (§7.1): review only when every visible question
    // is answered. Sequential Next-gating makes this structural, but a
    // guard here keeps the invariant explicit.
    if (compute_assembly().complete) show('review');
    return;
  }
  if (dir < 0 && state.idx === 0) { show('entry'); return; }
  state.idx += dir;
  render();
  window.scrollTo({ top: 0 });
}

function jump_to(qid) {
  const list = flow_questions();
  const i = list.findIndex(e => e.q.id === qid);
  if (i >= 0) { state.idx = i; show('flow'); }
}

function pick_mode(mode_id) {
  state.mode = mode_id;
  state.idx = 0;
  // Mode default (§3): Simple confidentiality is a toggle defaulting to
  // No; the default is materialized as an answer so the gate can pass.
  const m = model.modes.find(x => x.id === mode_id);
  if (m && m.overrides) {
    Object.entries(m.overrides).forEach(([qid, ov]) => {
      if (ov.default_option && !state.answers[qid]) {
        state.answers[qid] = { option_id: ov.default_option, inputs: {} };
      }
    });
  }
  show('flow');
}

function start_builder() {
  // A single-mode model has no mode choice to offer (engine v0.3):
  // enter the flow directly. The two-mode builder is unaffected.
  if (model.modes.length === 1) { pick_mode(model.modes[0].id); return; }
  show('entry');
}

function restart() {
  state.mode = null;
  state.idx = 0;
  state.answers = {};
  state.changed = new Set();
  show('landing');
}
