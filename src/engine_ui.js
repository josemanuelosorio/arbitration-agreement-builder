/* ------------------- clause preview panel --------------------- */

function sentence_html(s) {
  const changed = state.changed.has(s.key) ? 'changed' : '';
  return `<span class="frag ${changed}">${esc(s.text)}</span>${chip(s.status)} `;
}

function paragraph_html(items, cls) {
  if (!items.length) return '';
  const inner = items.map(x => x.sentences.map(sentence_html).join('')).join('');
  return `<p class="frag-p ${cls || ''}">${inner}</p>`;
}

function panel_html() {
  const asm = compute_assembly();
  const started = state.mode !== null && Object.keys(state.answers).length > 0;
  const de_out = state.output_lang === 'de';

  let body = '';
  if (de_out) {
    body += `<div class="annotation">${esc((model.ui_copy.de_output_note && t(model.ui_copy.de_output_note)) || 'German clause output: every fragment ships with a de slot, all "pending" until the final German pass (spec §7.4, §8 item 4). Showing English with this explicit notice, never a silent mix.')}</div>`;
  }
  if (!started) {
    body += `<p class="empty">${esc((model.ui_copy.panel_empty && t(model.ui_copy.panel_empty)) || 'Answer the questions and the clause assembles here in real time.')}</p>`;
  } else {
    // Framing per §5.1: header, empty line, clause text.
    body += paragraph_html(asm.groups.before, 'tier');
    body += paragraph_html(asm.groups.clause, '');
    body += paragraph_html(asm.groups.after, 'tier');
    asm.withheld.forEach(w => {
      body += `<div class="annotation rv">Withheld until complete: ${esc(w.frag.id)} (unfilled slot ${esc(w.missing.join(', '))}; §7.1 no-unfilled-slot rule).</div>`;
    });
    if (asm.advisories.length) {
      body += asm.advisories.map(a =>
        `<div class="advisory-box">${esc(t(a.text))} ${chip(a.status)}</div>`).join('');
    }
  }

  const copy_ok = asm.complete && started;
  return `<div class="panel">
    <div class="panel-head">
      <div class="ttl">Live preview · single source: content model v${esc(model.meta.version)}</div>
      <h3>${esc(t(model.assembly.output_header))}</h3>
      <div class="panel-ctls">
        <label>Output language:
          <select onchange="set_output_lang(this.value)">
            <option value="en" ${state.output_lang === 'en' ? 'selected' : ''}>English</option>
            <option value="de" ${state.output_lang === 'de' ? 'selected' : ''}>German</option>
          </select>
        </label>
        ${model.ui_copy.panel_note ? `<span class="rv">${esc(t(model.ui_copy.panel_note))}</span>` : `<span class="rv" title="Spec §9: LLM rewrites deferred from the MVP; fully deterministic build, nothing leaves the browser.">explain-this-clause: phase 2</span>`}
      </div>
    </div>
    <div class="clause">${body}</div>
    <div class="panel-foot">
      <button class="btn ghost" id="copy_btn" ${copy_ok ? '' : 'disabled'}
        title="${copy_ok ? 'Copy the assembled clause' : 'Available once every visible question is answered (completeness gate, §7.1)'}"
        onclick="copy_clause()">Copy to clipboard</button>
      <span class="copied" id="copied_msg">Copied.</span>
      <span class="rv" style="font-size:11px;color:var(--ink-soft)">${esc((model.ui_copy.panel_footnote && t(model.ui_copy.panel_footnote)) || 'placement before order: B/C paragraph_before · A paragraph_after · D replaces_base (§5.3)')}</span>
    </div>
  </div>`;
}

function refresh_panel() {
  const col = document.querySelector('.screen.on .panel-col');
  if (col) col.innerHTML = panel_html();
}

function set_output_lang(v) {
  state.output_lang = v;
  refresh_panel();
}

function clause_plain_text() {
  const asm = compute_assembly();
  const para = items => items.map(x => x.sentences.map(s => s.text).join(' ')).join(' ');
  const parts = [t(model.assembly.output_header), ''];
  if (asm.groups.before.length) parts.push(para(asm.groups.before), '');
  parts.push(para(asm.groups.clause));
  if (asm.groups.after.length) parts.push('', para(asm.groups.after));
  return parts.join('\n');
}

function copy_clause() {
  const text = clause_plain_text();
  const done = () => {
    const el = document.getElementById('copied_msg');
    if (el) { el.style.display = 'inline'; setTimeout(() => { el.style.display = 'none'; }, 1600); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallback_copy(text, done));
  } else {
    fallback_copy(text, done);
  }
}

function fallback_copy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* never die on copy */ }
  document.body.removeChild(ta);
  done();
}

/* --------------------- generic input widgets ------------------ */

function input_html(q, opt) {
  const spec = opt.input;
  if (!spec) return '';
  const a = state.answers[q.id] || {};
  const inputs = a.inputs || {};
  const lbl = esc(t(spec.label) || '');
  const hint = spec.validation_hint ? `<span class="rv"> · ${esc(spec.validation_hint)}</span>` : '';

  if (spec.type === 'dropdown') {
    const items = spec.items.map(it =>
      `<option value="${esc(it)}" ${inputs[spec.param] === it ? 'selected' : ''}>${esc(it)}</option>`).join('');
    return `<div class="opt-input"><label>${lbl}${hint}</label>
      <select onchange="set_input('${q.id}','${spec.param}',this.value)"><option value="">Select</option>${items}</select></div>`;
  }
  if (spec.type === 'dropdown_other_free_text') {
    const suffix = spec.item_display_suffix || '';
    const in_list = spec.items.includes(inputs[spec.param]);
    const other_active = inputs[spec.param] !== undefined && inputs[spec.param] !== '' && !in_list;
    const items = spec.items.map(it =>
      `<option value="${esc(it)}" ${inputs[spec.param] === it ? 'selected' : ''}>${esc(it + suffix)}</option>`).join('');
    return `<div class="opt-input"><label>${lbl}${hint}</label>
      <select onchange="dropdown_other_change('${q.id}','${spec.param}',this.value)">
        <option value="">Select</option>${items}
        <option value="__other__" ${other_active ? 'selected' : ''}>${esc(spec.other_label || 'Other')}</option>
      </select>
      ${other_active ? `<div style="margin-top:8px"><input type="text" placeholder="Specify" value="${esc(inputs[spec.param])}" oninput="set_input('${q.id}','${spec.param}',this.value)"></div>` : ''}
    </div>`;
  }
  if (spec.type === 'free_text') {
    return `<div class="opt-input"><label>${lbl}${hint}</label>
      <input type="text" placeholder="${esc(spec.placeholder || '')}" value="${esc(inputs[spec.param] || '')}" oninput="set_input('${q.id}','${spec.param}',this.value)"></div>`;
  }
  if (spec.type === 'integer') {
    return `<div class="opt-input"><label>${lbl}</label>
      <input type="number" min="${spec.min || 1}" step="1" placeholder="${esc(spec.placeholder || '')}" value="${esc(inputs[spec.param] || '')}" oninput="set_input('${q.id}','${spec.param}',this.value === '' ? '' : Number(this.value))"></div>`;
  }
  if (spec.type === 'amount_currency') {
    const p_amt = spec.params.amount, p_cur = spec.params.currency;
    const cur = spec.currencies.map(c => `<option ${inputs[p_cur] === c ? 'selected' : ''}>${c}</option>`).join('');
    return `<div class="opt-input"><label>${lbl}</label>
      <div class="row">
        <input type="number" min="0" step="any" placeholder="Amount" value="${esc(inputs[p_amt] || '')}" oninput="set_input('${q.id}','${p_amt}',this.value === '' ? '' : Number(this.value))">
        <select onchange="set_input('${q.id}','${p_cur}',this.value)">${cur}</select>
      </div>
      <div class="rv" style="margin-top:6px">Below-ICC-default warning dormant: default ceiling value pending content entry (model icc_default_expedited_threshold, §4.2.3).</div></div>`;
  }
  return '';
}

function dropdown_other_change(qid, param, value) {
  if (value === '__other__') {
    set_input(qid, param, ' ');   // sentinel space keeps "other" branch open, cleared on typing
    render();                     // re-render to show the free-text input
    const inp = document.querySelector('.screen.on .opt-input input[type=text]');
    if (inp) { inp.value = ''; set_input(qid, param, ''); inp.focus(); }
  } else {
    set_input(qid, param, value);
  }
}

/* ------------------------- screens ---------------------------- */

function show(screen) {
  state.screen = screen;
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('on'));
  document.getElementById('scr_' + screen).classList.add('on');
  render();
  window.scrollTo({ top: 0 });
}

function render() {
  const r = { landing: render_landing, entry: render_entry, flow: render_flow, review: render_review, thanks: render_thanks }[state.screen];
  if (r) r();
  render_de_banner();
}

function render_de_banner() {
  const el = document.getElementById('de_banner');
  const pending_ui = state.ui_lang === 'de';
  el.style.display = pending_ui ? 'block' : 'none';
  if (pending_ui) {
    el.textContent = (model.ui_copy.de_banner_ui && t(model.ui_copy.de_banner_ui)) ||
      'German is the final content pass (spec §7.4): every string ships with a de slot marked "pending". Showing the English fallback with this notice.';
  }
}

function review_kit() {
  const legend = Object.entries(model.meta.status_legend)
    .map(([k, v]) => `<span class="chip ${chip_class(k)[0]}" title="${esc(v)}">${esc(k)}</span>`).join(' ');
  const items = model.open_items
    .map(o => `<li><strong>${o.n}.</strong> <span class="mono-ref">${esc(o.spec_ref)}</span> ${esc(o.item)}</li>`).join('');
  return `<div class="card rv">
    <strong style="font-size:13.5px">Review mode</strong>
    <div class="legend">${legend}</div>
    <div class="rv-note">Statuses come from the content model, which mirrors the spec's ✅/⚠/⏭ markers. Hover any mark for the full note and spec reference.</div>
    <details class="openitems"><summary>${model.open_items.length} ${esc((model.ui_copy.open_items_label && t(model.ui_copy.open_items_label)) || 'open items (spec §8 + §4.2.3 substantive question)')}</summary><ol>${items}</ol></details>
  </div>`;
}

function render_landing() {
  const lp = model.ui_copy.landing_page;
  const steps = lp.how_it_works.steps.map(s =>
    `<div class="card"><div class="step-n">${esc(s.n)}</div><strong>${esc(t(s.title))}</strong><div style="color:var(--ink-soft);font-size:13.5px">${esc(t(s.body))}</div></div>`).join('');
  const props = lp.why_use.benefits.map(p =>
    `<div class="card vprop"><h3>${esc(t(p.title))} ${chip(p.status)}</h3><p>${esc(t(p.body))}</p></div>`).join('');
  const faq = lp.faq.items.map(f =>
    `<details class="faq-item"><summary>${esc(t(f.q))} ${chip(f.status)}</summary><p>${esc(t(f.a))}</p></details>`).join('');
  document.getElementById('scr_landing').innerHTML = `
    <div class="crumb">${esc(t(lp.breadcrumb))}</div>
    <h1>${esc(t(lp.hero.headline))} ${chip(lp.hero.status)}</h1>
    <p style="max-width:620px;font-size:16.5px">${esc(t(lp.hero.subheadline))}</p>
    <p><a class="btn primary" href="#" onclick="start_builder(); return false;">${esc(t(lp.hero.cta))}</a>
       <span class="cta-sub">${esc(t(lp.hero.cta_subtext))}</span></p>
    <h2>${esc(t(lp.problem_solution.headline))} ${chip(lp.problem_solution.status)}</h2>
    <p style="max-width:700px">${esc(t(lp.problem_solution.body))}</p>
    <h2>${esc(t(lp.how_it_works.headline))} ${chip(lp.how_it_works.status)}</h2>
    <p style="margin-top:-6px;color:var(--ink-soft)">${esc(t(lp.how_it_works.subheadline))}</p>
    <div class="steps">${steps}</div>
    <p><a class="btn ghost" href="#" onclick="start_builder(); return false;">${esc(t(lp.how_it_works.cta))}</a></p>
    <h2>${esc(t(lp.why_use.headline))}</h2>
    <div class="vprops">${props}</div>
    <h2>${esc(t(lp.faq.headline))}</h2>
    ${faq}
    <div class="final-cta">
      <h2 style="border-top:0;margin-top:0">${esc(t(lp.final_cta.headline))} ${chip(lp.final_cta.status)}</h2>
      <p style="color:var(--ink-soft)">${esc(t(lp.final_cta.subheadline))}</p>
      <p><a class="btn primary" href="#" onclick="start_builder(); return false;">${esc(t(lp.final_cta.cta))}</a></p>
      <p style="font-size:13px;color:var(--ink-soft)">${esc(t(lp.final_cta.secondary_text))}
         <a href="#" onclick="return false;">${esc(t(lp.final_cta.secondary_cta))}</a></p>
    </div>
    <div class="rv rv-note">Landing copy is spec Annex C (approved; Payload content, not repository content). C.7 flags three pre-decision passages: see the sign-off marks above.</div>
    ${review_kit()}`;
}

function render_entry() {
  const es = model.ui_copy.entry_screen;
  const buttons = es.mode_buttons.map(b =>
    `<button class="opt" style="font-size:17px;padding:18px" onclick="pick_mode('${b.mode}')">
       ${esc(t(b.label))}
       <span class="sub">${b.sub ? esc(t(b.sub)) : (b.mode === 'simple'
          ? '4 questions: arbitrators, seat, language, confidentiality (toggle, default No)'
          : 'Full option set in phases: core elements, procedural details, amicable resolution, final clause')}</span>
     </button>`).join('');
  document.getElementById('scr_entry').innerHTML = `
    <p class="kicker">${esc(t(es.kicker))}</p>
    <h1>${esc(t(es.title))} ${chip(es.status)}</h1>
    <div style="max-width:560px">${buttons}</div>
    <div class="rv rv-note">Two buttons vs one toggle is open (spec §8 item 7); prototype keeps two buttons.</div>
    <div class="btnrow"><a class="btn ghost" href="#" onclick="show('landing'); return false;">Back</a></div>
    ${review_kit()}`;
}

function render_flow() {
  const { list, entry } = current_entry();
  if (!entry) { show('entry'); return; }
  const q = entry.q;
  const m = mode_def();

  let progress_html = '';
  if (m.progress_style === 'step_x_of_4') {
    progress_html = `<div class="progress">Step ${state.idx + 1} of ${list.length}</div>`;
  } else {
    const romans = ['I', 'II', 'III', 'IV', 'V', 'VI'];
    const phases = m.phases.map((ph, pi) => {
      const idxs = list.map((e, i) => e.phase && e.phase.id === ph.id ? i : -1).filter(i => i >= 0);
      const cls = idxs.includes(state.idx) ? 'cur' : (idxs.length && Math.max(...idxs) < state.idx ? 'done' : '');
      return `<div class="phase ${cls}"><span class="num">${romans[pi]}.</span>${esc(t(ph.label))}</div>`;
    }).join('');
    const in_phase = list.filter(e => e.phase === entry.phase);
    const pos = in_phase.indexOf(entry) + 1;
    progress_html = `<div class="phasebar">${phases}</div>
      <div class="progress">${esc(t(entry.phase.label))}: question ${pos} of ${in_phase.length}</div>`;
  }

  // Final §8 item 3 texts shipped in model v0.4; the review chip on
  // tooltip_status carries the sign-off state, so no hardcoded suffix.
  const tip = q.tooltip && q.tooltip.en ? t(q.tooltip) : 'Tooltip pending (spec §8 item 3).';

  const a = state.answers[q.id];
  const opts_html = options_for(q).map(o => `
    <button class="opt ${a && a.option_id === o.id ? 'sel' : ''}" onclick="pick_option('${q.id}', '${o.id}')">
      ${esc(t(o.label))}
    </button>
    ${a && a.option_id === o.id ? input_html(q, o) : ''}`).join('');

  const ov = mode_override(q.id);
  const back_label = state.idx === 0 ? t(model.ui_copy.flow_buttons.back_variant_step1) : t(model.ui_copy.flow_buttons.back);
  const is_last = state.idx === list.length - 1;
  const next_label = is_last ? t(model.ui_copy.flow_buttons.review)
    : (state.idx === 0 ? t(model.ui_copy.flow_buttons.next_variant_step1) : t(model.ui_copy.flow_buttons.next));

  document.getElementById('scr_flow').innerHTML = `
    ${progress_html}
    <div class="grid2">
      <div>
        <div class="card" data-qid="${esc(q.id)}">
          <div class="topic">${esc(t(q.topic_label))}
            <span class="info-dot">i<span class="tip">${esc(tip)}</span></span>
            ${chip(q.tooltip_status)}
            <span class="chip wire" title="${esc((model.ui_copy.source_ref_title && t(model.ui_copy.source_ref_title)) || 'Spec section governing this question; Figma frame via spec Annex A crosswalk.')}">${esc(q.spec_ref)}${q.advanced_frame ? ' · frame ' + esc(q.advanced_frame) : ''}</span>
          </div>
          <div class="qtitle">${esc(t(q.title))} ${chip(q.title_status)}</div>
          ${q.explanation && q.explanation.en && model.ui_copy.explanation_ui ? `
          <details class="explain">
            <summary>${esc(t(model.ui_copy.explanation_ui.label))} ${chip(q.explanation_status)}</summary>
            <p>${esc(t(q.explanation))}</p>
          </details>` : ''}
          ${opts_html}
          <div class="rv rv-note">Options: ${esc(q.options_status || 'status not annotated')}</div>
          ${ov ? `<div class="rv rv-note">Mode override active: ${esc(ov.status || JSON.stringify(ov))}</div>` : ''}
          ${q.visible_if ? `<div class="rv rv-note">Conditional visibility: <code>${esc(JSON.stringify(q.visible_if))}</code> holds. ${esc(q.visible_if_status || '')}</div>` : ''}
        </div>
        <div class="btnrow">
          <button class="btn ghost" onclick="nav(-1)">${esc(back_label)}</button>
          <span class="push"></span>
          <button class="btn primary" id="next_btn" ${is_answered(q) ? '' : 'disabled'} onclick="nav(1)">${esc(next_label)}</button>
        </div>
      </div>
      <div class="panel-col">${panel_html()}</div>
    </div>
    ${review_kit()}`;
}

function answer_label(q, a) {
  const o = options_for(q).find(x => x.id === a.option_id);
  let label = o ? t(o.label) : a.option_id;
  const vals = Object.entries(a.inputs || {})
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => k === 'threshold_amount' ? Number(v).toLocaleString('en-US') : v);
  if (vals.length) label += `: ${vals.join(' ')}`;
  return label;
}

function render_review() {
  const asm = compute_assembly();
  if (!asm.complete) { show('flow'); return; }   // completeness gate, §7.1
  const rows = asm.visible_entries.map(e => {
    const a = state.answers[e.q.id];
    return `<tr>
      <td class="q">${esc(t(e.q.topic_label))}</td>
      <td>${a ? esc(answer_label(e.q, a)) : ''}
          <a class="edit" href="#" onclick="jump_to('${e.q.id}'); return false;">edit</a></td>
    </tr>`;
  }).join('');

  const defaulted = asm.defaulted.length
    ? `<h2>${esc((model.unknown_answer_summary.heading && t(model.unknown_answer_summary.heading)) || 'Left to defaults')} <span class="chip assum" title="${esc(model.unknown_answer_summary.status)}">proposal</span></h2>
       <p style="font-size:13.5px;color:var(--ink-soft);margin:0">${esc((model.unknown_answer_summary.note && t(model.unknown_answer_summary.note)) || 'You answered "I don\'t know" here, so the standard treatment applies (spec §8 item 6, pending accept/reject):')}</p>
       <ul class="dlist">${asm.defaulted.map(d => `<li><strong>${esc(d.topic)}:</strong> ${esc(d.note)}</li>`).join('')}</ul>`
    : '';
  const delegated = asm.delegated.length
    ? `<h2>${esc((model.unknown_answer_summary.delegated_heading && t(model.unknown_answer_summary.delegated_heading)) || 'Delegated or left to the Rules by your choice')}</h2>
       <ul class="dlist">${asm.delegated.map(d => `<li><strong>${esc(d.topic)}:</strong> ${esc(d.note)}</li>`).join('')}</ul>`
    : '';

  document.getElementById('scr_review').innerHTML = `
    <h1>${esc(t(model.ui_copy.flow_buttons.review))}</h1>
    <div class="grid2">
      <div>
        <div class="card">
          <h2 style="margin-top:0;border-top:0;padding-top:0">Your answers</h2>
          <table class="answers">${rows}</table>
          ${defaulted}
          ${delegated}
        </div>
        <div class="btnrow">
          <button class="btn ghost" onclick="show('flow')">${esc(t(model.ui_copy.flow_buttons.back))}</button>
          <span class="push"></span>
          <button class="btn primary" onclick="show('thanks')">Finish
            <span class="chip assum" title="Button label not specified; assumption.">assumption</span>
          </button>
        </div>
      </div>
      <div class="panel-col">${panel_html()}</div>
    </div>
    ${review_kit()}`;
}

function render_thanks() {
  const ty = model.ui_copy.thank_you;
  document.getElementById('scr_thanks').innerHTML = `
    <div class="grid2">
      <div>
        <div class="card">
          <h1 style="font-size:26px">${esc(t(ty.title))} ${chip(ty.status)}</h1>
          <p>${esc(t(ty.body))}</p>
          <div class="btnrow">
            <button class="btn primary" title="Links to the enquiry flow; the form will carry the clause in a visible, editable pre-filled field (spec §7.9).">${esc(t(ty.cta))}</button>
            <button class="btn ghost" onclick="restart()">Start over</button>
          </div>
          <div class="rv rv-note">${model.ui_copy.thank_you.note ? esc(t(model.ui_copy.thank_you.note)) : 'Body verbatim per spec §6 (✅, punctuation preserved). Enquiry pre-fill mechanics per §7.9 are site-level, not part of this static page.'}</div>
        </div>
      </div>
      <div class="panel-col">${panel_html()}</div>
    </div>`;
}

/* --------------------------- init ----------------------------- */

function init() {
  document.querySelectorAll('#ui_lang_seg button').forEach(btn => {
    btn.addEventListener('click', () => {
      state.ui_lang = btn.dataset.lang;
      document.querySelectorAll('#ui_lang_seg button').forEach(b => b.classList.toggle('on', b === btn));
      render();
    });
  });
  document.getElementById('review_toggle').addEventListener('change', e => {
    document.body.classList.toggle('review', e.target.checked);
  });

  // Shell strings are model-overridable since engine v0.3 (second
  // content model); each falls back to the previous hardcoded text.
  const shell_copy = model.ui_copy.shell || {};
  if (shell_copy.page_title) document.title = t(shell_copy.page_title);
  const wm = document.getElementById('wordmark_sub');
  if (wm && shell_copy.wordmark_sub) wm.textContent = t(shell_copy.wordmark_sub);
  const pn = document.getElementById('proto_note');
  if (pn && shell_copy.proto_note) pn.innerHTML = esc(t(shell_copy.proto_note));

  const author_short = String(model.meta.author || '').split(',')[0];
  document.getElementById('stamp').innerHTML =
    `model v${esc(model.meta.version)} · ${esc(model.meta.date)} · ${esc((model.meta.stamp_note && model.meta.stamp_note) || 'implements spec v1.x (30.07)')}<br>prepared by ${esc(author_short)} · for owner review`;

  document.getElementById('disclaimer').innerHTML =
    `<p style="margin:0 0 6px">${esc((shell_copy.footer_line && t(shell_copy.footer_line)) || `prototype v${model.meta.version} · generic engine over the closed action set ; content model embedded (single source of truth) · single-institution by decision (§1.2), institution held as data, no literal institution reference in engine code`)}</p>
     <p style="margin:0">${esc((model.ui_copy.draft_disclaimer && t(model.ui_copy.draft_disclaimer)) || proto.draft_disclaimer)}</p>`;
  render();
}

document.addEventListener('DOMContentLoaded', init);
