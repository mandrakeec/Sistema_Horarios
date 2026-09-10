/**
 * PLANIFICADOR UNIVERSAL DE TURNOS Y GUARDIAS
 * Sistema completamente configurable: cualquier duración de turno, cualquier equipo
 * Versión 3.0 — Motor de rotación dinámico
 */

(function () {
  'use strict';

  // ==========================================
  // CONSTANTES GLOBALES
  // ==========================================
  const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const DAY_NAMES   = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const DAY_NAMES_FULL = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const STORAGE_KEY       = 'univ_shift_planner_v3';
  const STORAGE_SWAPS_KEY = 'univ_shift_swaps_v3';
  const STORAGE_YARDS_KEY = 'univ_shift_yards_v3';

  const CLOUD_CONFIG = {
    apiKey: 'AIzaSyCCOvYvnbydOr3czR_Qn52M-0cig9sqqrw',
    authDomain: 'sistema-horarios-13c81.firebaseapp.com',
    projectId: 'sistema-horarios-13c81',
    appId: '1:964530132843:web:8f82b86509fdb2b677de2e'
  };

  let YARD_IDS = ['TPG1', 'TPG2', 'TPG3', 'TPG4'];

  // ==========================================
  // UTILIDADES
  // ==========================================
  function genId() {
    return 'sh_' + Math.random().toString(36).substr(2, 9);
  }

  function formatDateISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatDisplayDate(date) {
    const dayName = DAY_NAMES_FULL[date.getDay()];
    const day = String(date.getDate()).padStart(2, '0');
    const monthName = MONTH_NAMES[date.getMonth()];
    return `${dayName} ${day} de ${monthName}`;
  }

  function getDaysDifference(baseDateStr, targetDate) {
    const parts = baseDateStr.split('-');
    const baseUTC = Date.UTC(+parts[0], +parts[1] - 1, +parts[2]);
    const targetUTC = Date.UTC(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    return Math.round((targetUTC - baseUTC) / 86400000);
  }

  function getShiftDuration(start, end) {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let startMin = sh * 60 + sm;
    let endMin   = eh * 60 + em;
    if (endMin <= startMin) endMin += 1440; // crosses midnight
    return (endMin - startMin) / 60;
  }

  function isNightShift(shift) {
    if (!shift) return false;
    const name = (shift.name || '').toLowerCase();
    if (name.includes('noche') || name.includes('noctur')) return true;
    const [sh, sm] = shift.start.split(':').map(Number);
    const [eh, em] = shift.end.split(':').map(Number);
    let startMin = sh * 60 + sm;
    let endMin   = eh * 60 + em;
    if (endMin <= startMin) endMin += 1440;
    // Ventana nocturna: 22:00 (1320) a 06:00 del día siguiente (1800)
    const nightStart = 22 * 60;
    const nightEnd   = 30 * 60;
    const overlap = Math.max(0, Math.min(endMin, nightEnd) - Math.max(startMin, nightStart));
    return overlap > 0 && overlap >= (endMin - startMin) / 2;
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function shortenName(name) {
    return name.length > 18 ? name.substring(0, 16) + '…' : name;
  }

  // ==========================================
  // CONFIGURACIÓN POR DEFECTO
  // ==========================================
  function buildDefaultConfig() {
    const shMorning   = genId();
    const shAfternoon = genId();
    const shNight     = genId();

    return {
      shifts: [
        { id: shMorning,   name: 'Mañana',  start: '07:00', end: '15:00', color: '#fbbf24' },
        { id: shAfternoon, name: 'Tarde',   start: '15:00', end: '23:00', color: '#c084fc' },
        { id: shNight,     name: 'Noche',   start: '23:00', end: '07:00', color: '#60a5fa' },
      ],
      staff: {
        primary:  ['LUIS', 'DAU', 'JORGE', 'DIXON'],
        external: ['TECNICO APOYO', 'GUARDIA EXTERNA']
      },
      rotation: {
        cycleLength: 8,
        baseDateStr: '2026-09-01',
        // Modo fijo: el ciclo repite igual para siempre.
        // Modo mensual: cada mes calendario reinicia y se planifica por semanas.
        monthMode:  false,
        monthChecks: [true, true, true, true],
        // pattern[personIdx][dayInCycle] = shiftId | null (libre)
        pattern: [
          [shMorning, shMorning, shAfternoon, shAfternoon, shNight, shNight, null, null],
          [null, null, shMorning, shMorning, shAfternoon, shAfternoon, shNight, shNight],
          [shNight, shNight, null, null, shMorning, shMorning, shAfternoon, shAfternoon],
          [shAfternoon, shAfternoon, shNight, shNight, null, null, shMorning, shMorning],
        ]
      }
    };
  }

  /**
   * Configuración con la que inicia un patio recién activado:
   * turnos base, pero SIN personal (se registra desde cero).
   */
  function buildEmptyYardConfig() {
    const shMorning   = genId();
    const shAfternoon = genId();
    const shNight     = genId();

    return {
      shifts: [
        { id: shMorning,   name: 'Mañana',  start: '07:00', end: '15:00', color: '#fbbf24' },
        { id: shAfternoon, name: 'Tarde',   start: '15:00', end: '23:00', color: '#c084fc' },
        { id: shNight,     name: 'Noche',   start: '23:00', end: '07:00', color: '#60a5fa' },
      ],
      staff:    { primary: [], external: [] },
      rotation: { cycleLength: 8, baseDateStr: '2026-09-01', monthMode: false, monthChecks: [true, true, true, true], pattern: [] }
    };
  }

  // ==========================================
  // ESTADO DE LA APLICACIÓN
  // ==========================================
  const defaultCfg = buildDefaultConfig();

  let state = {
    // Patios (megasistema): cada uno es una instancia independiente
    yardsActive: { TPG1: true, TPG2: false, TPG3: false, TPG4: false },
    activeYard:  'TPG1',
    yardColors: {},
    // Config del patio activo
    shifts:   [...defaultCfg.shifts],
    staff:    { primary: [...defaultCfg.staff.primary], external: [...defaultCfg.staff.external] },
    rotation: { ...defaultCfg.rotation, pattern: defaultCfg.rotation.pattern.map(r => [...r]) },
    // UI
    selectedYear:       new Date().getFullYear(),
    selectedMonth:      new Date().getMonth(),
    currentView:        'list',
    selectedTechFilter: 'ALL',
    // Swaps: { 'YYYY-MM-DD': { 'personName': { replacement, reason, fromTime, toTime } } }
    swaps: {}
  };

  // Reemplazo/cambio en modo edición: { dateKey, person } o null
  let swapEditing = null;

  // ==========================================
  // PERSISTENCIA (una instancia independiente por patio)
  // ==========================================
  function yardConfigKey()  { return `${STORAGE_KEY}_${state.activeYard}`; }
  function yardSwapsKey()   { return `${STORAGE_SWAPS_KEY}_${state.activeYard}`; }

  function saveConfig() {
    try {
      localStorage.setItem(yardConfigKey(), JSON.stringify({
        shifts:   state.shifts,
        staff:    state.staff,
        rotation: state.rotation
      }));
      localStorage.setItem(yardSwapsKey(), JSON.stringify(state.swaps));
    } catch (e) { console.error('Error guardando config:', e); }
  }

  function loadConfig() {
    try {
      // Migrar datos antiguos (v2) solo si aún no existe ningún patio guardado
      const oldConfig = localStorage.getItem('tpg_schedule_config_v2');
      if (oldConfig && !localStorage.getItem(yardConfigKey()) && !localStorage.getItem(STORAGE_KEY)) {
        const old = JSON.parse(oldConfig);
        const cfg = buildDefaultConfig();
        if (old.technicians && Array.isArray(old.technicians)) {
          cfg.staff.primary = old.technicians;
          cfg.rotation.pattern = cfg.rotation.pattern.slice(0, old.technicians.length);
        }
        if (old.externalTechnicians) cfg.staff.external = old.externalTechnicians;
        if (old.baseDateStr) cfg.rotation.baseDateStr = old.baseDateStr;
        applyConfig(cfg);
        const oldSwaps = localStorage.getItem('tpg_schedule_swaps_v2');
        if (oldSwaps) state.swaps = JSON.parse(oldSwaps);
        saveConfig();
        return;
      }

      // El sistema actual (clave v3 única) pasa a ser TPG1
      if (state.activeYard === 'TPG1' && !localStorage.getItem(yardConfigKey())) {
        const legacyCfg = localStorage.getItem(STORAGE_KEY);
        if (legacyCfg) {
          applyConfig(JSON.parse(legacyCfg));
          migratePalette();
          const legacySwaps = localStorage.getItem(STORAGE_SWAPS_KEY);
          if (legacySwaps) state.swaps = JSON.parse(legacySwaps);
          saveConfig();
          return;
        }
      }

      const savedCfg = localStorage.getItem(yardConfigKey());
      if (savedCfg) {
        applyConfig(JSON.parse(savedCfg));
        migratePalette();
      } else {
        // TPG1 (sistema original) mantiene la config por defecto completa;
        // los patios recién activados arrancan vacíos (registro desde cero)
        applyConfig(state.activeYard === 'TPG1' ? buildDefaultConfig() : buildEmptyYardConfig());
      }

      const savedSwaps = localStorage.getItem(yardSwapsKey());
      state.swaps = savedSwaps ? JSON.parse(savedSwaps) : {};
    } catch (e) { console.error('Error cargando config:', e); }
  }

  function loadYardMeta() {
    try {
      const raw = localStorage.getItem(STORAGE_YARDS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.yards) && parsed.yards.length > 0) {
        // Restaurar la lista completa de patios (incluye los creados por el usuario)
        YARD_IDS = parsed.yards;
        YARD_IDS.forEach(id => {
          if (!(id in state.yardsActive)) state.yardsActive[id] = false;
        });
      }
      if (parsed && parsed.yardsActive) {
        YARD_IDS.forEach(id => {
          if (typeof parsed.yardsActive[id] === 'boolean') state.yardsActive[id] = parsed.yardsActive[id];
        });
      }
      if (parsed && parsed.yardColors) {
        YARD_IDS.forEach(id => {
          if (typeof parsed.yardColors[id] === 'string' && /^#[0-9a-fA-F]{6}$/.test(parsed.yardColors[id])) {
            state.yardColors[id] = parsed.yardColors[id];
          }
        });
      }
      if (parsed && parsed.activeYard &&
          YARD_IDS.includes(parsed.activeYard) && state.yardsActive[parsed.activeYard]) {
        state.activeYard = parsed.activeYard;
      }
    } catch (e) { console.error('Error cargando patios:', e); }
  }

  function saveYardMeta() {
    try {
      localStorage.setItem(STORAGE_YARDS_KEY, JSON.stringify({
        yards: YARD_IDS,
        yardsActive: state.yardsActive,
        yardColors: state.yardColors,
        activeYard: state.activeYard
      }));
    } catch (e) { console.error('Error guardando patios:', e); }
  }

  function applyConfig(cfg) {
    if (cfg.shifts && Array.isArray(cfg.shifts) && cfg.shifts.length > 0) {
      state.shifts = cfg.shifts;
    }
    if (cfg.staff) {
      if (Array.isArray(cfg.staff.primary))  state.staff.primary  = cfg.staff.primary;
      if (Array.isArray(cfg.staff.external)) state.staff.external = cfg.staff.external;
    }
    if (cfg.rotation) {
      if (typeof cfg.rotation.cycleLength === 'number') state.rotation.cycleLength = cfg.rotation.cycleLength;
      if (cfg.rotation.baseDateStr) state.rotation.baseDateStr = cfg.rotation.baseDateStr;
      if (Array.isArray(cfg.rotation.pattern)) state.rotation.pattern = cfg.rotation.pattern;
      if (typeof cfg.rotation.monthMode === 'boolean') state.rotation.monthMode = cfg.rotation.monthMode;
      if (Array.isArray(cfg.rotation.monthChecks) && cfg.rotation.monthChecks.length === 4) {
        state.rotation.monthChecks = cfg.rotation.monthChecks.slice();
      }
    }
    // Make sure pattern has right number of rows and columns
    normalizePattern();
  }

  /**
   * Ensures the rotation pattern dimensions match staff count and cycle length.
   */
  /**
   * Ancho de cada fila del patrón según el modo:
   * fijo = días del ciclo; mensual = 4 semanas (28 días del mes calendario).
   */
  function patternWidth() {
    return state.rotation.monthMode ? 28 : state.rotation.cycleLength;
  }

  function normalizePattern() {
    const n = state.staff.primary.length;
    const c = patternWidth();
    // Resize to n rows
    while (state.rotation.pattern.length < n) {
      state.rotation.pattern.push(new Array(c).fill(null));
    }
    state.rotation.pattern.length = n;
    // Resize each row to c columns
    for (let i = 0; i < n; i++) {
      if (!Array.isArray(state.rotation.pattern[i])) {
        state.rotation.pattern[i] = new Array(c).fill(null);
      }
      while (state.rotation.pattern[i].length < c) {
        state.rotation.pattern[i].push(null);
      }
      state.rotation.pattern[i].length = c;
    }
  }

  /**
   * Actualiza la paleta por defecto de los 3 turnos base si conservan
   * los colores originales, para reflejar los tonos suaves (estilo HORARIOS2).
   */
  function migratePalette() {
    const bright = ['#fbbf24', '#c084fc', '#60a5fa'];
    const legacy = [
      ['#4A9EFF', '#F59E0B'],
      ['#FF9500', '#8B5CF6'],
      ['#8B5CF6', '#3B82F6']
    ];
    state.shifts.forEach((shift, idx) => {
      if (idx < 3 && legacy[idx].includes(shift.color.toUpperCase())) {
        shift.color = bright[idx];
      }
    });
  }

  // ==========================================
  // PATIOS (megasistema multi-patio)
  // Cada patio es una instancia independiente:
  // turnos, personal, rotación y cambios propios.
  // ==========================================
  function renderYardBar() {
    const bar = document.getElementById('yardPills');
    if (!bar) return;
    bar.innerHTML = '';
    YARD_IDS.forEach(id => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'yard-pill';
      pill.dataset.yard = id;
      if (id === state.activeYard) pill.classList.add('active');
      if (!state.yardsActive[id]) pill.classList.add('inactive');
      const color = state.yardColors[id] || '#3b82f6';
      pill.style.setProperty('--yard-c', color);
      if (id === state.activeYard) pill.style.borderColor = hexToRgba(color, 0.6);
      pill.innerHTML = `<i class="fa-solid fa-warehouse" style="color:${color}"></i> ${id}${id === state.activeYard ? ' <span class="yard-live-dot"></span>' : ''}`;
      pill.title = state.yardsActive[id]
        ? `Ver ${id} (configuración independiente)`
        : `${id} desactivado — actívalo en "Gestionar Patios"`;
      bar.appendChild(pill);
    });
    renderYardManageList();
  }

  function renderYardManageList() {
    const list = document.getElementById('yardManageList');
    if (!list) return;
    list.innerHTML = '';
    YARD_IDS.forEach(id => {
      const active = state.yardsActive[id];
      const isCurrent = id === state.activeYard;
      const color = state.yardColors[id] || '#3b82f6';
      const item = document.createElement('div');
      item.className = 'yard-manage-item';
      item.dataset.yard = id;
      item.innerHTML = `
        <div class="yard-manage-info">
          <div class="yard-manage-title-row">
            <strong data-yard-name="${id}">${id}</strong>
            ${isCurrent ? '<span class="yard-current-tag">Activo ahora</span>' : ''}
          </div>
          <small>${active
            ? 'Habilitado con su propia configuración de turnos, personal, rotación y cambios.'
            : 'Desactivado. Al activarlo inicia con turnos base y sin personal (se registra desde cero).'}</small>
        </div>
        <div class="yard-manage-actions">
          <button class="btn-icon-sm btn-move-yard" data-yard="${id}" data-dir="-1" title="Mover arriba">
            <i class="fa-solid fa-arrow-up"></i>
          </button>
          <button class="btn-icon-sm btn-move-yard" data-yard="${id}" data-dir="1" title="Mover abajo">
            <i class="fa-solid fa-arrow-down"></i>
          </button>
          <span class="yard-color-wrap">
            <button class="yard-color-btn" data-yard-color="${id}" style="background:${color};" title="Color del patio (paleta RGB/HSL/HEX)">
              <i class="fa-solid fa-palette"></i>
            </button>
            <input type="color" class="yard-color-input" data-yard-color-input="${id}" value="${color}">
          </span>
          <button class="btn-icon-sm btn-rename-yard" data-yard="${id}" title="Renombrar patio">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="btn-icon-sm btn-danger btn-delete-yard" data-yard="${id}" title="Eliminar patio">
            <i class="fa-solid fa-trash"></i>
          </button>
          <label class="switch" title="${active ? 'Desactivar' : 'Activar'} ${id}">
            <input type="checkbox" data-yard-toggle="${id}" ${active ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
      `;
      list.appendChild(item);
    });
    // Bloque: crear un patio nuevo desde cero
    const addBlock = document.createElement('div');
    addBlock.className = 'yard-add-block';
    addBlock.innerHTML = `
      <div class="yard-add-info">
        <strong><i class="fa-solid fa-plus"></i> Nuevo patio</strong>
        <small>Se crea desde cero: turnos base (Mañana/Tarde/Noche) y sin personal. No clona otro patio.</small>
      </div>
      <div class="yard-add-controls">
        <input id="newYardInput" class="form-input" maxlength="24" value="${nextYardName()}" title="Nombre del patio" />
        <button id="addYardBtn" class="btn btn-primary btn-sm">Agregar</button>
      </div>
    `;
    list.appendChild(addBlock);
    const addInput = document.getElementById('newYardInput');
    if (addInput) addInput.select();
  }

  function nextYardName() {
    let n = 1;
    while (YARD_IDS.includes('TPG' + n)) n++;
    return 'TPG' + n;
  }

  /**
   * Crea un patio nuevo como instancia independiente desde cero.
   */
  function addNewYard() {
    const input = document.getElementById('newYardInput');
    let name = (input && input.value ? input.value : '').trim().toUpperCase();
    if (!name) name = nextYardName();
    if (YARD_IDS.includes(name)) {
      showToast(`El patio ${name} ya existe.`, 'error');
      renderYardManageList();
      const ni = document.getElementById('newYardInput');
      if (ni) { ni.value = nextYardName(); ni.focus(); }
      return;
    }
    // Guardar el patio actual antes de cambiar
    saveConfig();
    YARD_IDS.push(name);
    state.yardsActive[name] = true;
    state.activeYard = name;
    saveYardMeta();
    applyConfig(buildEmptyYardConfig());
    state.swaps = {};
    saveConfig();
    state.selectedTechFilter = 'ALL';
    const filter = document.getElementById('filterTechnician');
    if (filter) filter.value = 'ALL';
    populateTechSelects();
    closeYardModal();
    renderAll();
    showToast(`Patio ${name} creado desde cero. Configura turnos, personal y rotación.`);
  }

  /**
   * Establece el color de la píldora de un patio.
   */
  function setYardColor(id, color) {
    if (!YARD_IDS.includes(id)) return;
    if (/^#[0-9a-fA-F]{6}$/.test(color)) {
      state.yardColors[id] = color;
      saveYardMeta();
      renderYardManageList();
      renderYardBar();
    }
  }

  /**
   * Reordena la lista (y la barra) de patios, igual que los turnos.
   */
  function moveYard(idx, dir) {
    const target = idx + dir;
    if (target < 0 || target >= YARD_IDS.length) return;
    const id = YARD_IDS[idx];
    YARD_IDS.splice(idx, 1);
    YARD_IDS.splice(target, 0, id);
    saveYardMeta();
    renderYardManageList();
    renderYardBar();
  }

  /**
   * Renombra un patio; mueve su configuración y cambios al nuevo nombre.
   */
  function renameYard(oldName, newName) {
    const name = (newName || '').trim().toUpperCase();
    if (!name) { showToast('El nombre del patio no puede quedar vacío.', 'error'); return false; }
    if (name === oldName) return true;
    if (YARD_IDS.includes(name)) {
      showToast(`Ya existe un patio llamado ${name}.`, 'error');
      return false;
    }
    const idx = YARD_IDS.indexOf(oldName);
    if (idx === -1) return false;
    YARD_IDS[idx] = name;
    // Mover almacenamiento de configuración y cambios al nuevo nombre
    try {
      const cfg = localStorage.getItem(`${STORAGE_KEY}_${oldName}`);
      if (cfg !== null) {
        localStorage.setItem(`${STORAGE_KEY}_${name}`, cfg);
        localStorage.removeItem(`${STORAGE_KEY}_${oldName}`);
      }
      const swp = localStorage.getItem(`${STORAGE_SWAPS_KEY}_${oldName}`);
      if (swp !== null) {
        localStorage.setItem(`${STORAGE_SWAPS_KEY}_${name}`, swp);
        localStorage.removeItem(`${STORAGE_SWAPS_KEY}_${oldName}`);
      }
    } catch (e) { console.error('Error moviendo datos del patio:', e); }
    state.yardsActive[name] = state.yardsActive[oldName];
    delete state.yardsActive[oldName];
    if (state.yardColors[oldName]) {
      state.yardColors[name] = state.yardColors[oldName];
      delete state.yardColors[oldName];
    }
    if (state.activeYard === oldName) state.activeYard = name;
    saveYardMeta();
    renderYardManageList();
    renderYardBar();
    renderAll();
    showToast(`Patio renombrado a ${name}.`);
    return true;
  }

  /**
   * Convierte el nombre de un patio en un campo de edición inline.
   */
  function startYardRename(item) {
    const id = item.dataset.yard;
    const strong = item.querySelector('[data-yard-name]');
    if (!strong || item.dataset.editing) return;
    item.dataset.editing = '1';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'staff-edit-input yard-rename-input';
    input.value = id;
    input.maxLength = 24;
    strong.replaceWith(input);
    input.focus();
    input.select();
    const finish = save => {
      if (!item.dataset.editing) return;
      delete item.dataset.editing;
      if (save) renameYard(id, input.value.trim());
      renderYardManageList();
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  /**
   * Elimina un patio y toda su configuración (no se puede deshacer).
   */
  function deleteYard(id) {
    if (YARD_IDS.length <= 1) {
      showToast('Debe quedar al menos un patio.', 'error');
      return;
    }
    if (!confirm(`¿Eliminar el patio ${id}? Se borrará su configuración, personal, rotación, cambios y color. Esto no se puede deshacer.`)) return;

    const wasActive = id === state.activeYard;
    if (wasActive) {
      const next = YARD_IDS.find(y => y !== id && state.yardsActive[y]) || YARD_IDS.find(y => y !== id);
      if (!next) return;
      state.activeYard = next;
      loadConfig();
      state.selectedTechFilter = 'ALL';
      const filter = document.getElementById('filterTechnician');
      if (filter) filter.value = 'ALL';
      populateTechSelects();
    }
    YARD_IDS = YARD_IDS.filter(y => y !== id);
    delete state.yardsActive[id];
    delete state.yardColors[id];
    try {
      localStorage.removeItem(`${STORAGE_KEY}_${id}`);
      localStorage.removeItem(`${STORAGE_SWAPS_KEY}_${id}`);
    } catch (e) { /* ignore */ }
    saveYardMeta();
    renderAll();
    showToast(`Patio ${id} eliminado.`);
  }

  function switchYard(id) {
    if (id === state.activeYard) return;
    if (!state.yardsActive[id]) {
      showToast(`El patio ${id} no está activado.`, 'error');
      return;
    }
    // Persistir el estado del patio actual antes de cambiar
    saveConfig();
    state.activeYard = id;
    loadConfig();
    state.selectedTechFilter = 'ALL';
    const filter = document.getElementById('filterTechnician');
    if (filter) filter.value = 'ALL';
    populateTechSelects();
    saveYardMeta();
    renderAll();
    showToast(`Viendo ${id}.`);
  }

  function setYardActive(id, on) {
    if (on) {
      state.yardsActive[id] = true;
    } else {
      const activeCount = YARD_IDS.filter(y => state.yardsActive[y]).length;
      if (activeCount <= 1) {
        showToast('Debe quedar al menos un patio activo.', 'error');
        state.yardsActive[id] = true;
        renderYardManageList();
        return;
      }
      if (id === state.activeYard) {
        saveConfig();
        const next = YARD_IDS.find(y => y !== id && state.yardsActive[y]) || 'TPG1';
        state.activeYard = next;
        loadConfig();
        state.selectedTechFilter = 'ALL';
        const filter = document.getElementById('filterTechnician');
        if (filter) filter.value = 'ALL';
        populateTechSelects();
      }
      state.yardsActive[id] = false;
    }
    saveYardMeta();
    renderYardBar();
    renderAll();
    showToast(on ? `Patio ${id} activado.` : `Patio ${id} desactivado.`);
  }

  function openYardModal() {
    renderYardManageList();
    document.getElementById('yardModal').classList.add('open');
  }

  function closeYardModal() {
    document.getElementById('yardModal').classList.remove('open');
  }

  // ==========================================
  // MOTOR MATEMÁTICO DE ROTACIÓN
  // ==========================================
  /**
   * Semanas marcadas como "manuales" (fuente del modelo mensual).
   * Si no hay ninguna, el modelo copia la Semana 1.
   */
  function getManualWeeks() {
    const checks = state.rotation.monthChecks && state.rotation.monthChecks.length === 4
      ? state.rotation.monthChecks : [true, true, true, true];
    const manual = [];
    checks.forEach((c, w) => { if (c) manual.push(w); });
    if (manual.length === 0) manual.push(0);
    return manual;
  }

  /**
   * Columna del patrón (0..27) que corresponde a un día del mes (1..31)
   * en modo mensual. Cada semana marcada corresponde a su propia semana del
   * mes; las semanas NO marcadas salen libres (null) y no se repiten.
   */
  function monthSourceColumn(dayOfMonth) {
    const manual = getManualWeeks();
    const week = Math.min(3, Math.floor((dayOfMonth - 1) / 7)); // 0..3
    if (manual.indexOf(week) === -1) return null; // semana no marcada → libre
    return week * 7 + ((dayOfMonth - 1) % 7);
  }

  /**
   * Returns the schedule for a given date.
   * shiftAssignments: { shiftId: [personNames...] }
   * personAssignments: { personName: shiftId | null }
   */
  function getDailySchedule(date) {
    const diff     = getDaysDifference(state.rotation.baseDateStr, date);
    const cycleLen = state.rotation.cycleLength;
    const monthMode = !!state.rotation.monthMode;
    const dateStr  = formatDateISO(date);
    const daySwaps = state.swaps[dateStr] || {};

    const personAssignments = {}; // personName -> shiftId or null
    const shiftAssignments  = {}; // shiftId -> [personNames]

    // Base rotation for primary staff
    state.staff.primary.forEach((person, idx) => {
      const pattern = state.rotation.pattern[idx];
      if (!pattern || pattern.length === 0) {
        personAssignments[person] = null;
        return;
      }
      // Modo mensual: cada mes calendario reinicia su propio guión (ancla = día 1).
      // Modo fijo: ciclo continuo desde la fecha ancla.
      const cycleDay = monthMode
        ? monthSourceColumn(date.getDate())
        : ((diff % cycleLen) + cycleLen) % cycleLen;
      if (cycleDay == null) {
        personAssignments[person] = null;
        return;
      }
      const shiftId  = pattern[cycleDay] || null;
      personAssignments[person] = shiftId;
      if (shiftId) {
        if (!shiftAssignments[shiftId]) shiftAssignments[shiftId] = [];
        shiftAssignments[shiftId].push(person);
      }
    });

    // External staff are always unassigned by default
    state.staff.external.forEach(person => {
      personAssignments[person] = null;
    });

    // Apply swaps
    let hasSwaps = false;
    Object.entries(daySwaps).forEach(([originalPerson, swapData]) => {
      hasSwaps = true;
      const replacement = typeof swapData === 'object' ? swapData.replacement : swapData;
      const origShiftId = personAssignments[originalPerson];

      if (origShiftId) {
        // Remove original person from their shift
        if (shiftAssignments[origShiftId]) {
          shiftAssignments[origShiftId] = shiftAssignments[origShiftId].filter(p => p !== originalPerson);
        }

        if (state.staff.primary.includes(replacement)) {
          // Swap between two primary staff
          const replShiftId = personAssignments[replacement];
          personAssignments[originalPerson] = replShiftId;
          personAssignments[replacement]    = origShiftId;
          if (replShiftId) {
            if (!shiftAssignments[replShiftId]) shiftAssignments[replShiftId] = [];
            shiftAssignments[replShiftId] = shiftAssignments[replShiftId].filter(p => p !== replacement);
            shiftAssignments[replShiftId].push(originalPerson);
          }
        } else {
          // External replacement
          personAssignments[originalPerson] = null;
          personAssignments[replacement]    = origShiftId;
        }

        // Assign replacement to original shift
        if (!shiftAssignments[origShiftId]) shiftAssignments[origShiftId] = [];
        if (!shiftAssignments[origShiftId].includes(replacement)) {
          shiftAssignments[origShiftId].push(replacement);
        }
      }
    });

    return {
      date, dateStr,
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
      hasSwaps,
      daySwaps,
      shiftAssignments,   // shiftId -> [persons]
      personAssignments   // person -> shiftId | null
    };
  }

  // ==========================================
  // INICIALIZACIÓN
  // ==========================================
  function init() {
    loadYardMeta();
    loadConfig();
    populateYearSelect();
    populateTechSelects();
    setupEventListeners();
    applyTheme();
    renderAll();
    startCloudSync();
  }

  function populateYearSelect() {
    const yearSelect = document.getElementById('selectYear');
    yearSelect.innerHTML = '';
    for (let y = 2020; y <= 2040; y++) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      if (y === state.selectedYear) opt.selected = true;
      yearSelect.appendChild(opt);
    }
  }

  function populateTechSelects() {
    // Filter dropdown
    const filterSelect = document.getElementById('filterTechnician');
    filterSelect.innerHTML = '<option value="ALL">👥 Todos</option>';

    if (state.staff.primary.length > 0) {
      const grpP = document.createElement('optgroup');
      grpP.label = 'Personal Titular';
      state.staff.primary.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = `👤 ${p}`;
        if (state.selectedTechFilter === p) opt.selected = true;
        grpP.appendChild(opt);
      });
      filterSelect.appendChild(grpP);
    }

    if (state.staff.external.length > 0) {
      const grpE = document.createElement('optgroup');
      grpE.label = 'Personal Externo / Reemplazo';
      state.staff.external.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = `🔄 ${p}`;
        if (state.selectedTechFilter === p) opt.selected = true;
        grpE.appendChild(opt);
      });
      filterSelect.appendChild(grpE);
    }

    // Swap form selects
    const swapA = document.getElementById('swapTechA');
    const swapB = document.getElementById('swapTechB');

    if (swapA) {
      swapA.innerHTML = '';
      state.staff.primary.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        swapA.appendChild(opt);
      });
    }

    if (swapB) {
      swapB.innerHTML = '';
      const g1 = document.createElement('optgroup');
      g1.label = 'Personal Titular';
      state.staff.primary.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        g1.appendChild(opt);
      });
      swapB.appendChild(g1);

      if (state.staff.external.length > 0) {
        const g2 = document.createElement('optgroup');
        g2.label = 'Personal Externo / Reemplazo';
        state.staff.external.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p;
          opt.textContent = `[Externo] ${p}`;
          g2.appendChild(opt);
        });
        swapB.appendChild(g2);
      }
    }
  }

  // ==========================================
  // RENDERIZADO GENERAL
  // ==========================================
  function renderAll() {
    renderYardBar();
    updateTitles();
    updateSwapBadge();
    renderLegend();
    renderStats();

    switch (state.currentView) {
      case 'list':     renderListView();     break;
      case 'calendar': renderCalendarView(); break;
      case 'matrix':   renderMatrixView();   break;
      case 'annual':   renderAnnualView();   break;
      case 'coverage': renderCoverageView(); break;
      case 'swaps':    renderSwapsHistory(); break;
    }
  }

  function updateTitles() {
    const mn = MONTH_NAMES[state.selectedMonth];
    const y  = state.selectedYear;
    const ym = state.activeYard;
    const setT = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    setT('listTitle',     `Horario ${ym}: ${mn} ${y}`);
    setT('calendarTitle', `Calendario de Turnos ${ym}: ${mn} ${y}`);
    setT('matrixTitle',   `Matriz Mensual ${ym}: ${mn} ${y}`);
    setT('annualTitle',   `Resumen Anual ${ym}: ${y}`);
    setT('coverageTitle', `Cobertura ${ym}: ${mn} ${y}`);
  }

  function updateSwapBadge() {
    const badge = document.getElementById('swapBadge');
    if (!badge) return;
    const count = Object.keys(state.swaps).length;
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-block' : 'none';
  }

  function renderLegend() {
    const bar = document.getElementById('dynamicLegend');
    if (!bar) return;
    bar.innerHTML = '';
    state.shifts.forEach(shift => {
      const dur = getShiftDuration(shift.start, shift.end);
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.innerHTML = `
        <span class="legend-badge" style="background:${hexToRgba(shift.color, 0.15)};color:${shift.color};border:1px solid ${hexToRgba(shift.color, 0.4)};">${shift.start}–${shift.end}</span>
        <span class="legend-label">${shift.name} (${dur}h)</span>
      `;
      bar.appendChild(item);
    });
    // Add "Libre" legend
    const libre = document.createElement('div');
    libre.className = 'legend-item';
    libre.innerHTML = `<span class="legend-badge tag-libre">LIBRE</span><span class="legend-label">Descanso</span>`;
    bar.appendChild(libre);
  }

  function renderStats() {
    const container = document.getElementById('metricsContainer');
    if (!container) return;
    container.innerHTML = '';

    const year = state.selectedYear;
    const month = state.selectedMonth;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    if (state.selectedTechFilter !== 'ALL') {
      const tech = state.selectedTechFilter;
      let workedDays = 0, freeDays = 0, nightCount = 0, weekendWork = 0, totalHours = 0;

      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month, d);
        const sched = getDailySchedule(date);
        const shiftId = sched.personAssignments[tech];
        if (shiftId) {
          const shift = state.shifts.find(s => s.id === shiftId);
          if (shift) {
            workedDays++;
            totalHours += getShiftDuration(shift.start, shift.end);
            const isNight = isNightShift(shift);
            if (isNight) nightCount++;
            if (sched.isWeekend) weekendWork++;
          }
        } else {
          freeDays++;
        }
      }

      container.innerHTML = `
        <div class="stat-pill"><i class="fa-solid fa-clock"></i> Horas Totales: <strong>${totalHours} hrs</strong></div>
        <div class="stat-pill"><i class="fa-solid fa-briefcase"></i> Días Trabajados: <strong>${workedDays}</strong></div>
        <div class="stat-pill"><i class="fa-solid fa-bed"></i> Días Libres: <strong>${freeDays}</strong></div>
        <div class="stat-pill"><i class="fa-solid fa-moon"></i> Turnos Noche: <strong>${nightCount}</strong></div>
        <div class="stat-pill"><i class="fa-solid fa-calendar-check"></i> Fines de Semana: <strong>${weekendWork}</strong></div>
      `;
    } else {
      const totalTechs = state.staff.primary.length + state.staff.external.length;
      const totalHoursMonth = daysInMonth * 24;
      container.innerHTML = `
        <div class="stat-pill"><i class="fa-solid fa-shield-halved"></i> Cobertura: <strong>100% (24/7/365)</strong></div>
        <div class="stat-pill"><i class="fa-solid fa-users"></i> Técnicos Registrados: <strong>${totalTechs}</strong></div>
        <div class="stat-pill"><i class="fa-solid fa-business-time"></i> Horas Operativas del Mes: <strong>${totalHoursMonth} hrs</strong></div>
      `;
    }
  }

  // ==========================================
  // 1. VISTA LISTA
  // ==========================================
  function renderListView() {
    const tbody = document.getElementById('excelTableBody');
    tbody.innerHTML = '';
    const searchTerm = (document.getElementById('listSearch').value || '').toLowerCase().trim();
    const daysInMonth = new Date(state.selectedYear, state.selectedMonth + 1, 0).getDate();

    // Sort shifts by start time
    const sortedShifts = [...state.shifts].sort((a, b) => a.start.localeCompare(b.start));

    for (let d = 1; d <= daysInMonth; d++) {
      const date     = new Date(state.selectedYear, state.selectedMonth, d);
      const schedule = getDailySchedule(date);
      const dateStr  = formatDisplayDate(date);
      const isWeekend = schedule.isWeekend;
      let dayHasRows = false;

      sortedShifts.forEach(shift => {
        const persons = schedule.shiftAssignments[shift.id] || [];
        if (persons.length === 0) return;

        persons.forEach(person => {
          if (state.selectedTechFilter !== 'ALL' && state.selectedTechFilter !== person) return;

          const swapEntry = schedule.daySwaps[person] ||
            Object.entries(schedule.daySwaps).find(([orig, d]) => {
              const rep = typeof d === 'object' ? d.replacement : d;
              return rep === person;
            });

          const searchStr = `${dateStr} ${shift.name} ${person}`.toLowerCase();
          if (searchTerm && !searchStr.includes(searchTerm)) return;

          const isExternal = state.staff.external.includes(person);
          const swapData   = typeof swapEntry === 'object' && !Array.isArray(swapEntry) ? swapEntry : (swapEntry ? swapEntry[1] : null);
          const hasPartial = swapData && swapData.fromTime;

          let badgeHtml = '';
          if (isExternal) {
            badgeHtml = `<span class="is-external-tag"><i class="fa-solid fa-arrows-rotate"></i> EXTERNO</span>`;
          } else if (swapEntry) {
            if (hasPartial) {
              badgeHtml = `<span class="is-partial-tag"><i class="fa-solid fa-clock"></i> PARCIAL ${swapData.fromTime}–${swapData.toTime}</span>`;
            } else {
              badgeHtml = `<span class="is-swapped-tag"><i class="fa-solid fa-right-left"></i> CAMBIO</span>`;
            }
          }

          const row = document.createElement('tr');
          if (isWeekend) row.classList.add('weekend-row');
          if (!dayHasRows) {
            row.classList.add('day-first-row');
            dayHasRows = true;
          }

          row.innerHTML = `
            <td>${dateStr}</td>
            <td>
              <span class="shift-tag" style="background:${hexToRgba(shift.color, 0.15)};color:${shift.color};border:1px solid ${hexToRgba(shift.color, 0.4)};">${shift.name}</span>
              <span class="shift-time">${shift.start}–${shift.end}</span>
            </td>
            <td>
              <span class="tech-name">${person}</span>
              ${badgeHtml}
            </td>
          `;
          tbody.appendChild(row);
        });
      });

      // If all staff are libre (no assignments for this day), show a free-day row
      if (!dayHasRows && (state.selectedTechFilter === 'ALL')) {
        const hasAnyAssignment = Object.values(schedule.shiftAssignments).some(p => p.length > 0);
        if (!hasAnyAssignment) {
          const row = document.createElement('tr');
          if (isWeekend) row.classList.add('weekend-row');
          row.innerHTML = `
            <td>${dateStr}</td>
            <td><span class="shift-tag tag-libre">LIBRE</span></td>
            <td><span class="text-muted">Sin asignaciones</span></td>
          `;
          tbody.appendChild(row);
        }
      }
    }

    if (tbody.children.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:30px;color:var(--text-muted);">No se encontraron turnos con los filtros seleccionados.</td></tr>`;
    }
  }

  // ==========================================
  // 2. VISTA CALENDARIO
  // ==========================================
  function renderCalendarView() {
    const container = document.getElementById('calendarDaysGrid');
    container.innerHTML = '';
    const year = state.selectedYear;
    const month = state.selectedMonth;

    const firstDay = new Date(year, month, 1);
    let startDOW = firstDay.getDay() - 1;
    if (startDOW === -1) startDOW = 6;

    const daysInMonth    = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

    for (let i = startDOW - 1; i >= 0; i--) {
      container.appendChild(createCalendarCell(new Date(year, month - 1, daysInPrevMonth - i), true));
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const isToday = isCurrentMonth && today.getDate() === d;
      container.appendChild(createCalendarCell(new Date(year, month, d), false, isToday));
    }
    const totalCells = container.children.length;
    const remaining  = (7 - (totalCells % 7)) % 7;
    for (let n = 1; n <= remaining; n++) {
      container.appendChild(createCalendarCell(new Date(year, month + 1, n), true));
    }
  }

  function createCalendarCell(date, isOther, isToday = false) {
    const cell = document.createElement('div');
    cell.className = `cal-day-cell${isOther ? ' other-month' : ''}${isToday ? ' is-today' : ''}`;
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    if (isWeekend) cell.classList.add('is-weekend');

    const schedule = getDailySchedule(date);
    cell.innerHTML = `
      <div class="cal-day-header">
        <span>${DAY_NAMES[date.getDay()].toUpperCase()}</span>
        <strong>${date.getDate()}</strong>
      </div>
    `;

    const sortedShifts = [...state.shifts].sort((a, b) => a.start.localeCompare(b.start));
    const listEl = document.createElement('div');
    listEl.className = 'cal-shifts-list';

    sortedShifts.forEach(shift => {
      const persons = schedule.shiftAssignments[shift.id] || [];
      if (persons.length === 0) return;
      persons.forEach(person => {
        const isHighlight = state.selectedTechFilter === 'ALL' || state.selectedTechFilter === person;
        const pill = document.createElement('div');
        pill.className = 'cal-shift-pill';
        pill.style.background = hexToRgba(shift.color, 0.15);
        pill.style.color = shift.color;
        pill.style.border = `1px solid ${hexToRgba(shift.color, 0.4)}`;
        pill.style.opacity = isHighlight ? '1' : '0.3';
        if (state.selectedTechFilter !== 'ALL' && isHighlight) {
          pill.style.boxShadow = `0 0 0 2px ${hexToRgba(shift.color, 0.6)}`;
        }
        pill.innerHTML = `
          <span class="s-code">${shift.name}</span>
          <span class="s-tech">${shortenName(person)}</span>
        `;
        listEl.appendChild(pill);
      });
    });

    state.staff.primary.forEach(person => {
      if (schedule.personAssignments[person] !== null) return;
      if (state.selectedTechFilter !== 'ALL' && state.selectedTechFilter !== person) return;
      const isHighlight = state.selectedTechFilter === 'ALL' || state.selectedTechFilter === person;
      const pill = document.createElement('div');
      pill.className = 'cal-shift-pill is-libre';
      pill.style.opacity = isHighlight ? '1' : '0.3';
      if (state.selectedTechFilter !== 'ALL' && isHighlight) {
        pill.style.boxShadow = `0 0 0 2px rgba(239,68,68,0.6)`;
      }
      pill.innerHTML = `
        <span class="s-code">LIBRE</span>
        <span class="s-tech">${shortenName(person)}</span>
      `;
      listEl.appendChild(pill);
    });

    cell.appendChild(listEl);
    return cell;
  }

  // ==========================================
  // 3. VISTA MATRIZ MENSUAL
  // ==========================================
  function renderMatrixView() {
    const thead = document.getElementById('matrixHead');
    const tbody = document.getElementById('matrixBody');
    thead.innerHTML = '';
    tbody.innerHTML = '';

    const year = state.selectedYear;
    const month = state.selectedMonth;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Header
    const headRow = document.createElement('tr');
    headRow.innerHTML = '<th>Personal</th>';
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const dayColor = isWeekend ? 'var(--danger)' : 'var(--text-main)';
      headRow.innerHTML += `
        <th class="${isWeekend ? 'weekend-head' : ''}">
          <div style="font-size:0.6rem;font-weight:600;color:var(--text-dim);">${DAY_NAMES[date.getDay()].substring(0, 1).toUpperCase()}</div>
          <div style="font-size:0.9rem;font-weight:800;color:${dayColor};">${d}</div>
        </th>
      `;
    }
    thead.appendChild(headRow);

    // Rows for each person
    const allPersons = [
      ...state.staff.primary,
      ...state.staff.external.filter(ext => {
        // Only show externals who have at least one swap this month
        return Object.entries(state.swaps).some(([dateKey, swaps]) => {
          const d = new Date(dateKey);
          return d.getFullYear() === year && d.getMonth() === month &&
            Object.values(swaps).some(s => {
              const rep = typeof s === 'object' ? s.replacement : s;
              return rep === ext;
            });
        });
      })
    ];

    allPersons.forEach(person => {
      if (state.selectedTechFilter !== 'ALL' && state.selectedTechFilter !== person) return;

      const row = document.createElement('tr');
      const isExt = state.staff.external.includes(person);
      row.innerHTML = `<td class="matrix-person-cell">${isExt ? '🔄 ' : ''}${person}</td>`;

      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month, d);
        const schedule = getDailySchedule(date);
        const shiftId  = schedule.personAssignments[person];
        const shift    = shiftId ? state.shifts.find(s => s.id === shiftId) : null;
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const isSwap  = schedule.daySwaps && schedule.daySwaps[person];

        let cellContent = '';
        if (shift) {
          const abbr = shift.name.substring(0, 3).toUpperCase();
          cellContent = `<span class="matrix-shift-tag" style="background:${hexToRgba(shift.color, 0.15)};color:${shift.color};border:1px solid ${hexToRgba(shift.color, 0.4)};" title="${shift.name} ${shift.start}-${shift.end}">${abbr}</span>`;
          if (isSwap) cellContent += '<span class="matrix-swap-dot" title="Cambio registrado">⇄</span>';
        } else {
          cellContent = `<span class="matrix-free-tag">L</span>`;
        }

        row.innerHTML += `<td class="matrix-day-cell ${isWeekend ? 'weekend-cell' : ''}">${cellContent}</td>`;
      }

      tbody.appendChild(row);
    });
  }

  // ==========================================
  // 4B. VISTA COBERTURA (puestos cubiertos por turno)
  // ==========================================
  function renderCoverageView() {
    const thead = document.getElementById('coverageHead');
    const tbody = document.getElementById('coverageBody');
    if (!thead || !tbody) return;
    thead.innerHTML = '';
    tbody.innerHTML = '';

    const year = state.selectedYear;
    const month = state.selectedMonth;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Header: Turno + días
    const headRow = document.createElement('tr');
    headRow.innerHTML = '<th class="coverage-shift-name">Turno</th>';
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      headRow.innerHTML += `
        <th class="${isWeekend ? 'weekend-head' : ''}">
          <div style="font-size:0.6rem;font-weight:600;color:var(--text-dim);">${DAY_NAMES[date.getDay()].substring(0, 1).toUpperCase()}</div>
          <div style="font-size:0.9rem;font-weight:800;color:${isWeekend ? 'var(--danger)' : 'var(--text-main)'};">${d}</div>
        </th>
      `;
    }
    thead.appendChild(headRow);

    // Filas: un turno por fila, con el número de personas que lo cubren
    const sortedShifts = [...state.shifts].sort((a, b) => a.start.localeCompare(b.start));

    sortedShifts.forEach(shift => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td class="coverage-shift-name">
          <span class="shift-tag" style="background:${hexToRgba(shift.color, 0.15)};color:${shift.color};border:1px solid ${hexToRgba(shift.color, 0.4)};">${shift.name}</span>
          <span class="shift-time">${shift.start}–${shift.end}</span>
        </td>
      `;
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month, d);
        const schedule = getDailySchedule(date);
        const persons = schedule.shiftAssignments[shift.id] || [];
        const count = persons.length;
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const cls = count === 0 ? 'cov-empty' : (count >= 2 ? 'cov-strong' : 'cov-ok');
        row.innerHTML += `
          <td class="matrix-day-cell ${isWeekend ? 'weekend-cell' : ''}">
            <span class="cov-cell ${cls}" title="${persons.length ? persons.join(', ') : 'Sin cobertura'}">${count}</span>
          </td>
        `;
      }
      tbody.appendChild(row);
    });
  }
  function renderAnnualView() {
    const container = document.getElementById('annualGridContainer');
    container.innerHTML = '';
    const year = state.selectedYear;

    for (let m = 0; m < 12; m++) {
      const monthCard = document.createElement('div');
      monthCard.className = 'annual-month-card';

      const daysInMonth = new Date(year, m + 1, 0).getDate();
      const firstDay    = new Date(year, m, 1);
      let   startDOW    = firstDay.getDay() - 1;
      if (startDOW === -1) startDOW = 6;

      let html = `
        <div class="annual-month-title">${MONTH_NAMES[m]}</div>
        <div class="annual-mini-grid">
          <div class="annual-weekday-row">
            ${['L','M','X','J','V','S','D'].map((dl, i) => `<span${i >= 5 ? ' style="color:var(--weekend-color);font-weight:800;"' : ''}>${dl}</span>`).join('')}
          </div>
          <div class="annual-days-row">
      `;

      // Empty cells
      for (let i = 0; i < startDOW; i++) html += '<span class="annual-empty"></span>';

      for (let d = 1; d <= daysInMonth; d++) {
        const date     = new Date(year, m, d);
        const schedule = getDailySchedule(date);
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const today    = new Date();
        const isToday  = d === today.getDate() && m === today.getMonth() && year === today.getFullYear();

        let bg = 'var(--surface-2)';
        let title = 'LIBRE';

        if (state.selectedTechFilter !== 'ALL') {
          const fShiftId = schedule.personAssignments[state.selectedTechFilter];
          const fShift   = fShiftId ? state.shifts.find(s => s.id === fShiftId) : null;
          if (fShift) { bg = fShift.color; title = fShift.name; }
          title = `${state.selectedTechFilter}: ${title}`;
        } else {
          // Show dominant shift color (most staff assigned)
          let maxCount = 0;
          let domShift = null;
          Object.entries(schedule.shiftAssignments).forEach(([sId, persons]) => {
            if (persons.length > maxCount) { maxCount = persons.length; domShift = sId; }
          });
          if (domShift) {
            const shift = state.shifts.find(s => s.id === domShift);
            if (shift) { bg = hexToRgba(shift.color, 0.5); title = shift.name; }
          }
          const parts = [];
          [...state.shifts].sort((a, b) => a.start.localeCompare(b.start)).forEach(shift => {
            const persons = schedule.shiftAssignments[shift.id];
            if (persons && persons.length > 0) parts.push(`${shift.name}: ${persons.join(', ')}`);
          });
          const librePeople = state.staff.primary.filter(p => schedule.personAssignments[p] === null);
          if (librePeople.length > 0) parts.push(`LIBRE: ${librePeople.join(', ')}`);
          title = parts.length > 0 ? parts.join(' | ') : 'LIBRE';
        }

        const hasSwap = Object.keys(schedule.daySwaps).length > 0;
        html += `<span
          class="annual-day${isWeekend ? ' annual-weekend' : ''}${isToday ? ' annual-today' : ''}${hasSwap ? ' annual-swap' : ''}"
          style="background:${bg};"
          title="${d} ${MONTH_NAMES[m]} — ${title}${hasSwap ? ' ⇄ Cambio' : ''}"
        >${d}</span>`;
      }

      html += '</div></div>';
      monthCard.innerHTML = html;
      container.appendChild(monthCard);
    }
  }

  // ==========================================
  // 5. VISTA HISTORIAL DE REEMPLAZOS
  // ==========================================
  function renderSwapsHistory() {
    const tbody = document.getElementById('swapsTableBody');
    tbody.innerHTML = '';

    const swapEntries = Object.entries(state.swaps).sort((a, b) => a[0].localeCompare(b[0]));

    if (swapEntries.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);">No hay reemplazos registrados.</td></tr>`;
      return;
    }

    swapEntries.forEach(([dateKey, swapsOnDay]) => {
      Object.entries(swapsOnDay).forEach(([origPerson, swapData]) => {
        const replacement = typeof swapData === 'object' ? swapData.replacement : swapData;
        const reason      = typeof swapData === 'object' ? (swapData.reason || '—') : '—';
        const fromTime    = typeof swapData === 'object' ? swapData.fromTime : null;
        const toTime      = typeof swapData === 'object' ? swapData.toTime : null;
        const horario     = fromTime ? `${fromTime} – ${toTime}` : 'Turno completo';
        const editing = swapEditing && swapEditing.dateKey === dateKey && swapEditing.person === origPerson;

        const row = document.createElement('tr');
        if (editing) row.className = 'swap-editing-row';
        row.innerHTML = `
          <td>${dateKey}</td>
          <td><span class="tech-name">${origPerson}</span></td>
          <td><span class="tech-name">${replacement}</span>${state.staff.external.includes(replacement) ? ' <span class="is-external-tag">EXTERNO</span>' : ''}</td>
          <td><span class="partial-time-badge">${horario}</span></td>
          <td>${reason}</td>
          <td>
            <button class="btn btn-outline btn-sm btn-edit-swap" data-date="${dateKey}" data-person="${origPerson}" title="Modificar reemplazo">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button class="btn btn-danger btn-sm btn-delete-swap" data-date="${dateKey}" data-person="${origPerson}" title="Eliminar reemplazo">
              <i class="fa-solid fa-trash"></i>
            </button>
          </td>
        `;
        tbody.appendChild(row);
      });
    });
  }

  function startSwapEdit(dateKey, person) {
    const data = state.swaps[dateKey] && state.swaps[dateKey][person];
    if (!data) return;
    swapEditing = { dateKey, person };
    document.getElementById('swapDate').value = dateKey;
    const selA = document.getElementById('swapTechA');
    if (selA && [...selA.options].some(o => o.value === person)) selA.value = person;
    const selB = document.getElementById('swapTechB');
    if (selB && [...selB.options].some(o => o.value === data.replacement)) selB.value = data.replacement;
    document.getElementById('swapReason').value    = data.reason || '';
    document.getElementById('swapFromTime').value  = data.fromTime || '';
    document.getElementById('swapToTime').value    = data.toTime || '';
    updateSwapFormMode(true);
    renderSwapsHistory();
    const heading = document.querySelector('.swap-form-card h3');
    if (heading) heading.innerHTML = '<i class="fa-solid fa-pen"></i> Modificando Reemplazo de: ' + person;
    showToast(`Editando el reemplazo de ${person}. Cambia lo necesario y pulsa Guardar Cambios.`);
  }

  function cancelSwapEdit() {
    swapEditing = null;
    updateSwapFormMode(false);
    const heading = document.querySelector('.swap-form-card h3');
    if (heading) heading.innerHTML = '<i class="fa-solid fa-right-left"></i> Registrar Reemplazo o Cambio de Turno';
    renderSwapsHistory();
    showToast('Edición cancelada.');
  }

  function updateSwapFormMode(editing) {
    const btn       = document.getElementById('swapSubmitBtn');
    const cancelBtn = document.getElementById('swapCancelEditBtn');
    if (!btn || !cancelBtn) return;
    btn.innerHTML = editing
      ? '<i class="fa-solid fa-floppy-disk"></i> Guardar Cambios'
      : '<i class="fa-solid fa-plus-circle"></i> Aplicar Reemplazo';
    cancelBtn.style.display = editing ? 'inline-flex' : 'none';
  }

  // ==========================================
  // CONFIGURACIÓN MODAL — TURNOS
  // ==========================================
  function renderShiftsList() {
    const container = document.getElementById('shiftsList');
    if (!container) return;
    container.innerHTML = '';

    if (state.shifts.length === 0) {
      container.innerHTML = `<p class="empty-state-msg">No hay turnos configurados. Agrega al menos uno.</p>`;
      return;
    }

    state.shifts.forEach((shift, idx) => {
      const dur = getShiftDuration(shift.start, shift.end);
      const item = document.createElement('div');
      item.className = 'shift-config-item';
      item.dataset.idx = idx;
      item.innerHTML = `
        <span class="shift-color-dot" data-role="dot" style="background:${shift.color};"></span>
        <span class="shift-config-name" data-role="name">${shift.name}</span>
        <span class="shift-config-time" data-role="time">${shift.start} → ${shift.end}</span>
        <span class="shift-config-dur" data-role="dur">${dur}h</span>
        <div class="staff-actions">
          <button class="btn-icon-sm btn-move-shift" data-idx="${idx}" data-dir="-1" title="Mover arriba">
            <i class="fa-solid fa-arrow-up"></i>
          </button>
          <button class="btn-icon-sm btn-move-shift" data-idx="${idx}" data-dir="1" title="Mover abajo">
            <i class="fa-solid fa-arrow-down"></i>
          </button>
          <button class="btn-icon-sm btn-edit-shift" data-idx="${idx}" title="Modificar turno">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="btn btn-danger btn-sm btn-delete-shift" data-idx="${idx}" title="Eliminar turno">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      `;
      container.appendChild(item);
    });
  }

  // ==========================================
  // TURNOS — MODIFICAR Y REORDENAR
  // ==========================================
  /**
   * Mueve un turno dentro de la lista (solo afecta el orden de muestra;
   * el patrón de rotación referencia turnos por id, así que se respeta).
   */
  function moveShift(idx, dir) {
    const target = idx + dir;
    if (target < 0 || target >= state.shifts.length) return;
    const shift = state.shifts[idx];
    state.shifts.splice(idx, 1);
    state.shifts.splice(target, 0, shift);
  }

  /**
   * Aplica las modificaciones de un turno. Devuelve true si se aplicó.
   */
  function updateShift(idx, data) {
    const shift = state.shifts[idx];
    const name  = (data.name || '').trim();
    if (!name) { showToast('El nombre del turno no puede quedar vacío.', 'error'); return false; }
    const dup = state.shifts.find((s, i) => i !== idx && s.name.toLowerCase() === name.toLowerCase());
    if (dup) { showToast(`Ya existe un turno llamado "${name}".`, 'error'); return false; }
    if (!data.start || !data.end) { showToast('Ingresa hora de inicio y fin.', 'error'); return false; }

    shift.name  = name;
    shift.start = data.start;
    shift.end   = data.end;
    if (data.color && /^#[0-9a-fA-F]{6}$/.test(data.color)) shift.color = data.color;
    return true;
  }

  /**
   * Convierte el item de un turno en un formulario inline de edición.
   */
  function startShiftEdit(item) {
    const idx = parseInt(item.dataset.idx, 10);
    const shift = state.shifts[idx];
    if (!shift) return;
    item.dataset.editing = '1';
    item.classList.add('editing');
    item.innerHTML = `
      <span class="shift-color-dot" data-role="dot" style="background:${shift.color};"></span>
      <input type="text" class="shift-edit-input shift-edit-name" value="${shift.name}" maxlength="30" placeholder="Nombre del turno">
      <input type="time" class="shift-edit-input shift-edit-start" value="${shift.start}" title="Hora inicio">
      <input type="time" class="shift-edit-input shift-edit-end" value="${shift.end}" title="Hora fin">
      <span class="shift-edit-color-wrap">
        <span class="shift-edit-color-label"><i class="fa-solid fa-palette"></i></span>
        <input type="color" class="shift-edit-color" value="${shift.color}" title="Color del turno">
      </span>
      <div class="staff-actions">
        <button class="btn btn-success btn-sm shift-edit-save" title="Guardar">
          <i class="fa-solid fa-check"></i>
        </button>
        <button class="btn btn-outline btn-sm shift-edit-cancel" title="Cancelar">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `;
    const dot = item.querySelector('[data-role="dot"]');
    const colorInput = item.querySelector('.shift-edit-color');
    colorInput.addEventListener('input', () => { dot.style.background = colorInput.value; });
    const nameInput = item.querySelector('.shift-edit-name');
    nameInput.focus();
    nameInput.select();
    item.querySelectorAll('.shift-edit-input').forEach(inp => {
      inp.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') finishShiftEdit(item, true);
        else if (ev.key === 'Escape') finishShiftEdit(item, false);
      });
    });
  }

  /**
   * Termina la edición inline del turno: guarda (save=true) o cancela.
   */
  function finishShiftEdit(item, save) {
    if (save) {
      const idx = parseInt(item.dataset.idx, 10);
      const ok = updateShift(idx, {
        name:  item.querySelector('.shift-edit-name').value,
        start: item.querySelector('.shift-edit-start').value,
        end:   item.querySelector('.shift-edit-end').value,
        color: item.querySelector('.shift-edit-color').value
      });
      if (!ok) { renderShiftsList(); return; }
    }
    renderShiftsList();
    renderRotationBuilder();
  }

  // ==========================================
  // CONFIGURACIÓN MODAL — PERSONAL
  // ==========================================
  function renderPrimaryStaffList() {
    const container = document.getElementById('primaryStaffList');
    if (!container) return;
    container.innerHTML = '';

    if (state.staff.primary.length === 0) {
      container.innerHTML = `<p class="empty-state-msg">No hay personal titular. Agrega al menos uno.</p>`;
      return;
    }

    state.staff.primary.forEach((person, idx) => {
      const item = document.createElement('div');
      item.className = 'staff-item';
      item.dataset.idx = idx;
      item.innerHTML = `
        <i class="fa-solid fa-user-shield staff-icon" style="color:var(--primary);"></i>
        <span class="staff-name">${person}</span>
        <span class="staff-cycle-pos">Pos. ${idx + 1}</span>
        <div class="staff-actions">
          <button class="btn-icon-sm btn-move-primary" data-idx="${idx}" data-dir="-1" title="Mover arriba">
            <i class="fa-solid fa-arrow-up"></i>
          </button>
          <button class="btn-icon-sm btn-move-primary" data-idx="${idx}" data-dir="1" title="Mover abajo">
            <i class="fa-solid fa-arrow-down"></i>
          </button>
          <button class="btn-icon-sm btn-edit-primary" data-idx="${idx}" title="Editar nombre">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="btn btn-danger btn-sm btn-delete-primary" data-idx="${idx}" title="Eliminar titular">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      `;
      container.appendChild(item);
    });
  }

  function renderExternalTechsList() {
    const container = document.getElementById('externalTechsListContainer');
    if (!container) return;
    container.innerHTML = '';

    if (state.staff.external.length === 0) {
      container.innerHTML = `<p class="empty-state-msg">No hay personal externo registrado.</p>`;
      return;
    }

    state.staff.external.forEach((person, idx) => {
      const item = document.createElement('div');
      item.className = 'staff-item';
      item.dataset.idx = idx;
      item.innerHTML = `
        <i class="fa-solid fa-user-tag staff-icon" style="color:var(--success);"></i>
        <span class="staff-name">${person}</span>
        <div class="staff-actions">
          <button class="btn-icon-sm btn-move-ext" data-idx="${idx}" data-dir="-1" title="Mover arriba">
            <i class="fa-solid fa-arrow-up"></i>
          </button>
          <button class="btn-icon-sm btn-move-ext" data-idx="${idx}" data-dir="1" title="Mover abajo">
            <i class="fa-solid fa-arrow-down"></i>
          </button>
          <button class="btn-icon-sm btn-edit-ext" data-idx="${idx}" title="Editar nombre">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="btn btn-danger btn-sm btn-delete-ext" data-index="${idx}" title="Eliminar externo">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      `;
      container.appendChild(item);
    });
  }

  // ==========================================
  // PERSONAL — EDITAR NOMBRE Y REORDENAR
  // ==========================================
  /**
   * Renombra una persona (titular o externo), propagando el cambio
   * a los reemplazos/cambios ya registrados (state.swaps).
   * Devuelve true si el cambio se aplicó.
   */
  function renamePerson(oldName, newName, type) {
    newName = (newName || '').trim().toUpperCase();
    if (!newName) {
      showToast('El nombre no puede quedar vacío.', 'error');
      return false;
    }
    if (newName === oldName) return true;

    const list = type === 'primary' ? state.staff.primary : state.staff.external;
    const idx = list.indexOf(oldName);
    if (idx === -1) return false;

    const exists = state.staff.primary.includes(newName) || state.staff.external.includes(newName);
    if (exists) {
      showToast(`Ya existe una persona llamada "${newName}".`, 'error');
      return false;
    }

    list[idx] = newName;

    // Propagar el nuevo nombre a los reemplazos registrados
    Object.keys(state.swaps).forEach(dateKey => {
      const swapsDay = state.swaps[dateKey];
      Object.keys(swapsDay).forEach(orig => {
        const data = swapsDay[orig];
        if (orig === oldName) {
          delete swapsDay[orig];
          swapsDay[newName] = data;
        }
        if (typeof data === 'object' && data.replacement === oldName) {
          data.replacement = newName;
        }
      });
    });

    if (state.selectedTechFilter === oldName) state.selectedTechFilter = newName;
    return true;
  }

  /**
   * Mueve una persona dentro de su lista. En titulares, la fila de rotación
   * se mueve junto con la persona (misma posición en el ciclo).
   */
  function movePerson(type, idx, dir) {
    const list = type === 'primary' ? state.staff.primary : state.staff.external;
    const target = idx + dir;
    if (target < 0 || target >= list.length) return;
    const name = list[idx];
    list.splice(idx, 1);
    list.splice(target, 0, name);
    if (type === 'primary') {
      const patRow = state.rotation.pattern[idx];
      state.rotation.pattern.splice(idx, 1);
      state.rotation.pattern.splice(target, 0, patRow);
    }
  }

  /**
   * Convierte el item de una persona en un formulario inline de edición.
   */
  function startInlineEdit(item, type) {
    const idx = parseInt(item.dataset.idx, 10);
    const list = type === 'primary' ? state.staff.primary : state.staff.external;
    const current = list[idx];
    const isPrimary = type === 'primary';
    item.dataset.editing = '1';
    item.classList.add('editing');
    item.innerHTML = `
      <i class="fa-solid ${isPrimary ? 'fa-user-shield' : 'fa-user-tag'} staff-icon" style="color:${isPrimary ? 'var(--primary)' : 'var(--success)'};"></i>
      <input type="text" class="staff-edit-input" value="${current}" maxlength="40" spellcheck="false">
      <div class="staff-actions">
        <button class="btn btn-success btn-sm staff-edit-save" title="Guardar">
          <i class="fa-solid fa-check"></i>
        </button>
        <button class="btn btn-outline btn-sm staff-edit-cancel" title="Cancelar">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `;
    const input = item.querySelector('.staff-edit-input');
    input.focus();
    input.select();
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') finishInlineEdit(item, type, true);
      else if (ev.key === 'Escape') finishInlineEdit(item, type, false);
    });
  }

  /**
   * Termina la edición inline: guarda (apply=true) o cancela.
   */
  function finishInlineEdit(item, type, save) {
    if (save) {
      const idx = parseInt(item.dataset.idx, 10);
      const input = item.querySelector('.staff-edit-input');
      const list = type === 'primary' ? state.staff.primary : state.staff.external;
      const oldName = list[idx];
      if (!renamePerson(oldName, input.value, type)) {
        // Validación fallida: restauramos la lista tal cual
        if (type === 'primary') renderPrimaryStaffList(); else renderExternalTechsList();
        return;
      }
    }
    if (type === 'primary') renderPrimaryStaffList(); else renderExternalTechsList();
    populateTechSelects();
    renderRotationBuilder();
  }

  // ==========================================
  // CONFIGURACIÓN MODAL — ROTACIÓN (GRID BUILDER)
  // ==========================================
  function renderRotationBuilder() {
    const container = document.getElementById('rotationBuilderGrid');
    if (!container) return;

    // Sync mode controls
    const modeSelect = document.getElementById('rotationModeSelect');
    if (modeSelect) modeSelect.value = state.rotation.monthMode ? 'month' : 'fixed';
    const fixedControls = document.getElementById('fixedModeControls');
    const monthControls = document.getElementById('monthModeControls');
    if (fixedControls) fixedControls.style.display = state.rotation.monthMode ? 'none' : '';
    if (monthControls) monthControls.style.display  = state.rotation.monthMode ? '' : 'none';

    // Update inputs
    const clInput = document.getElementById('cycleLengthInput');
    const bdInput = document.getElementById('baseDateInput');
    if (clInput) clInput.value = state.rotation.cycleLength;
    if (bdInput) bdInput.value = state.rotation.baseDateStr;
    syncMonthChecksUI();

    if (state.staff.primary.length === 0 || state.shifts.length === 0) {
      container.innerHTML = `<p class="empty-state-msg">Agrega personal titular y al menos un turno para configurar la rotación.</p>`;
      return;
    }

    normalizePattern();
    const monthMode = !!state.rotation.monthMode;

    // Columnas visibles: modo fijo = 1..ciclo; modo mensual = solo semanas marcadas
    const columns = [];
    if (monthMode) {
      getManualWeeks().forEach((w, wi) => {
        for (let k = 0; k < 7; k++) {
          columns.push({ col: w * 7 + k, band: wi > 0 });
        }
      });
    } else {
      const cycleLen = state.rotation.cycleLength;
      for (let c = 0; c < cycleLen; c++) columns.push({ col: c, band: false });
    }

    // Build table
    let html = `<div class="rotation-grid-scroll"><table class="rotation-table">`;

    // Header row: Day 1, Day 2...
    html += `<thead><tr><th class="rot-person-head">Personal</th>`;
    columns.forEach(col => {
      const cls = col.band ? 'rot-day-head rot-week-band-start' : 'rot-day-head';
      html += `<th class="${cls}">Día ${col.col + 1}</th>`;
    });
    html += `</tr></thead><tbody>`;

    // Rows: one per primary staff member
    state.staff.primary.forEach((person, personIdx) => {
      html += `<tr><td class="rot-person-cell">${person}</td>`;
      columns.forEach(col => {
        const dayIdx = col.col;
        const shiftId = state.rotation.pattern[personIdx] ? state.rotation.pattern[personIdx][dayIdx] : null;
        const shift   = shiftId ? state.shifts.find(s => s.id === shiftId) : null;
        const label   = shift ? shift.name.substring(0, 4) : 'L';
        const color   = shift ? shift.color : 'transparent';
        const textCol = shift ? shift.color : 'var(--text-muted)';
        html += `
          <td class="rot-cell-wrap${col.band ? ' rot-week-band-start' : ''}">
            <button
              class="rot-cell-btn"
              data-person="${personIdx}"
              data-day="${dayIdx}"
              style="background:${shift ? hexToRgba(color, 0.15) : 'transparent'};color:${textCol};border-color:${shift ? hexToRgba(color, 0.4) : 'var(--border)'};"
              title="${shift ? shift.name + ' ' + shift.start + '–' + shift.end : 'Día Libre'}"
            >${label}</button>
          </td>
        `;
      });
      html += `</tr>`;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;

    // Attach click events to rotation cells
    container.querySelectorAll('.rot-cell-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const personIdx = parseInt(btn.dataset.person, 10);
        const dayIdx    = parseInt(btn.dataset.day, 10);
        cycleShiftInCell(personIdx, dayIdx, btn);
      });
    });
  }

  function syncMonthChecksUI() {
    const wrap = document.getElementById('monthWeekChecks');
    if (!wrap) return;
    const checks = state.rotation.monthChecks && state.rotation.monthChecks.length === 4
      ? state.rotation.monthChecks : [true, true, true, true];
    wrap.querySelectorAll('input[data-week]').forEach(cb => {
      const w = parseInt(cb.dataset.week, 10);
      cb.checked = !!checks[w];
      const label = cb.closest('.month-week-check');
      if (label) label.classList.toggle('off', !cb.checked);
    });
    const hint = document.getElementById('monthModelHint');
    if (hint) {
      const manual = getManualWeeks();
      hint.textContent = manual.length === 4
        ? 'Semana 1 a 4 marcadas: cada semana es distinta y se planifica a mano.'
        : `Marcadas: Semana ${manual.map(w => 'S' + (w + 1)).join(', ')}. Las semanas sin marcar salen libres.`;
    }
  }

  /**
   * Activa el modo de planificación: 'fixed' (ciclo repetido) o 'month' (mes calendario).
   */
  function setRotationMode(mode) {
    const monthMode = mode === 'month';
    if (monthMode === state.rotation.monthMode) return;
    state.rotation.monthMode = monthMode;
    if (monthMode) {
      // Resolver ancho de filas a 28 días (4 semanas)
      state.rotation.pattern.forEach(row => {
        while (row.length < 28) row.push(null);
        row.length = 28;
      });

      // Primera vez (checks aún en el default "todas marcadas"):
      // arrancar con SOLO la Semana 1 marcada. Las semanas sin marcar salen
      // libres; el usuario marca las que quiere planificar.
      const isDefaultChecks = state.rotation.monthChecks &&
        state.rotation.monthChecks.length === 4 &&
        state.rotation.monthChecks.every(Boolean);
      if (isDefaultChecks) {
        state.rotation.monthChecks = [true, false, false, false];
        showToast('Modo mensual: solo Semana 1 marcada. Marca las semanas a planificar (las demás salen libres).');
      } else {
        showToast('Modo mensual: plan por semanas del mes activado.');
      }
    } else {
      normalizePattern();
      showToast('Modo fijo: ciclo repetido desde la fecha ancla activado.');
    }
    renderRotationBuilder();
  }

  /**
   * Cycles to the next shift (or null=libre) when a rotation cell is clicked.
   */
  function cycleShiftInCell(personIdx, dayIdx, btn) {
    const currentShiftId = state.rotation.pattern[personIdx][dayIdx];
    const shiftIds       = state.shifts.map(s => s.id);
    const currentIdx     = shiftIds.indexOf(currentShiftId);
    // Cycle: shift[0] → shift[1] → ... → null → shift[0]
    let nextShiftId;
    if (currentIdx === -1) {
      nextShiftId = shiftIds[0]; // was null/libre, go to first shift
    } else if (currentIdx === shiftIds.length - 1) {
      nextShiftId = null; // wrap to libre
    } else {
      nextShiftId = shiftIds[currentIdx + 1];
    }

    state.rotation.pattern[personIdx][dayIdx] = nextShiftId;

    // Update button visually
    const shift   = nextShiftId ? state.shifts.find(s => s.id === nextShiftId) : null;
    const label   = shift ? shift.name.substring(0, 4) : 'L';
    const color   = shift ? shift.color : 'transparent';
    const textCol = shift ? shift.color : 'var(--text-muted)';
    btn.textContent = label;
    btn.style.background   = shift ? hexToRgba(color, 0.15) : 'transparent';
    btn.style.color        = textCol;
    btn.style.borderColor  = shift ? hexToRgba(color, 0.4) : 'var(--border)';
    btn.title              = shift ? `${shift.name} ${shift.start}–${shift.end}` : 'Día Libre';
  }

  // ==========================================
  // MODAL TABS
  // ==========================================
  function openConfigModal() {
    renderShiftsList();
    renderPrimaryStaffList();
    renderExternalTechsList();
    renderRotationBuilder();
    document.getElementById('configModal').classList.add('open');
  }

  function closeConfigModal() {
    document.getElementById('configModal').classList.remove('open');
  }

  function switchModalTab(tabName) {
    document.querySelectorAll('.modal-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.modalTab === tabName);
    });
    document.querySelectorAll('.modal-tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `panel-${tabName}`);
    });
  }

  // ==========================================
  // TEMA
  // ==========================================
  function applyTheme() {
    const saved = localStorage.getItem('shift_theme');
    if (saved === 'light') {
      document.body.classList.replace('theme-dark', 'theme-light');
    }
  }

  function toggleTheme() {
    if (document.body.classList.contains('theme-dark')) {
      document.body.classList.replace('theme-dark', 'theme-light');
      localStorage.setItem('shift_theme', 'light');
    } else {
      document.body.classList.replace('theme-light', 'theme-dark');
      localStorage.setItem('shift_theme', 'dark');
    }
  }

  // ==========================================
  // TOAST NOTIFICATIONS
  // ==========================================
  let toastTimer = null;
  function showToast(msg, type = 'success') {
    const toast = document.getElementById('toastNotification');
    toast.textContent = msg;
    toast.className = `toast toast-${type} show`;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  // ==========================================
  // EVENT LISTENERS
  // ==========================================
  function setupEventListeners() {

    // Theme toggle
    document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);

    // Nube (Firestore)
    const cloudSyncBtn = document.getElementById('cloudSyncBtn');
    if (cloudSyncBtn) cloudSyncBtn.addEventListener('click', pushToCloud);
    const cloudStatus = document.getElementById('cloudStatus');
    if (cloudStatus) {
      cloudStatus.addEventListener('click', e => {
        if (e.target.id === 'cloudApplyBtn') applyRemoteNow();
      });
    }

    // Patios — barra selector (delegado)
    const yardPills = document.getElementById('yardPills');
    if (yardPills) {
      yardPills.addEventListener('click', e => {
        const pill = e.target.closest('.yard-pill');
        if (!pill) return;
        switchYard(pill.dataset.yard);
      });
    }

    // Patios — modal de gestión
    document.getElementById('manageYardsBtn').addEventListener('click', openYardModal);
    const closeYardBtn = document.getElementById('closeYardModalBtn');
    if (closeYardBtn) closeYardBtn.addEventListener('click', closeYardModal);
    const yardModal = document.getElementById('yardModal');
    if (yardModal) {
      yardModal.addEventListener('click', e => {
        if (e.target === yardModal) closeYardModal();
      });
    }
    const yardManageList = document.getElementById('yardManageList');
    if (yardManageList) {
      yardManageList.addEventListener('change', e => {
        const toggle = e.target.closest('input[data-yard-toggle]');
        if (!toggle) return;
        setYardActive(toggle.dataset.yardToggle, toggle.checked);
      });
      yardManageList.addEventListener('click', e => {
        if (e.target.closest('#addYardBtn')) { addNewYard(); return; }
        const moveBtn = e.target.closest('.btn-move-yard');
        if (moveBtn) {
          const idx = YARD_IDS.indexOf(moveBtn.dataset.yard);
          moveYard(idx, parseInt(moveBtn.dataset.dir, 10));
          return;
        }
        const renameBtn = e.target.closest('.btn-rename-yard');
        if (renameBtn) {
          const item = renameBtn.closest('.yard-manage-item');
          startYardRename(item);
          return;
        }
        const delBtn = e.target.closest('.btn-delete-yard');
        if (delBtn) {
          const id = delBtn.dataset.yard;
          closeYardModal();
          deleteYard(id);
          return;
        }
        const swatch = e.target.closest('.yard-color-btn');
        if (swatch) {
          const input = swatch.parentElement.querySelector('.yard-color-input');
          if (input) input.click();
          return;
        }
      });
      yardManageList.addEventListener('change', e => {
        const color = e.target.closest('.yard-color-input');
        if (color) {
          setYardColor(color.dataset.yardColorInput, color.value);
        }
      });
      yardManageList.addEventListener('keydown', e => {
        if (e.target && e.target.id === 'newYardInput' && e.key === 'Enter') {
          e.preventDefault();
          addNewYard();
        }
      });
    }

    // Month / Year selects
    document.getElementById('selectMonth').addEventListener('change', e => {
      state.selectedMonth = parseInt(e.target.value);
      renderAll();
    });
    document.getElementById('selectYear').addEventListener('change', e => {
      state.selectedYear = parseInt(e.target.value);
      renderAll();
    });

    // Year navigation buttons
    document.getElementById('prevYearBtn').addEventListener('click', () => {
      state.selectedYear--;
      document.getElementById('selectYear').value = state.selectedYear;
      renderAll();
    });
    document.getElementById('nextYearBtn').addEventListener('click', () => {
      state.selectedYear++;
      document.getElementById('selectYear').value = state.selectedYear;
      renderAll();
    });

    // Today button
    document.getElementById('todayBtn').addEventListener('click', () => {
      const now = new Date();
      state.selectedMonth = now.getMonth();
      state.selectedYear  = now.getFullYear();
      document.getElementById('selectMonth').value = state.selectedMonth;
      document.getElementById('selectYear').value  = state.selectedYear;
      renderAll();
    });

    // Filter
    document.getElementById('filterTechnician').addEventListener('change', e => {
      state.selectedTechFilter = e.target.value;
      renderAll();
    });

    // View tabs
    document.querySelectorAll('.tab-btn[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.currentView = btn.dataset.view;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
        document.getElementById(`view${btn.dataset.view.charAt(0).toUpperCase() + btn.dataset.view.slice(1)}`).classList.add('active');
        renderAll();
      });
    });

    // Search
    document.getElementById('listSearch').addEventListener('input', renderListView);

    // Config modal
    document.getElementById('openConfigBtn').addEventListener('click', openConfigModal);
    document.getElementById('closeConfigModalBtn').addEventListener('click', closeConfigModal);
    document.getElementById('configModal').addEventListener('click', e => {
      if (e.target === document.getElementById('configModal')) closeConfigModal();
    });

    // Modal tabs
    document.querySelectorAll('.modal-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchModalTab(btn.dataset.modalTab));
    });

    // ---- Shifts Tab ----
    document.getElementById('addShiftBtn').addEventListener('click', () => {
      const name  = document.getElementById('newShiftName').value.trim();
      const start = document.getElementById('newShiftStart').value;
      const end   = document.getElementById('newShiftEnd').value;
      const color = document.getElementById('newShiftColor').value;

      if (!name) { showToast('Ingresa un nombre para el turno.', 'error'); return; }
      if (!start || !end) { showToast('Ingresa hora de inicio y fin.', 'error'); return; }

      state.shifts.push({ id: genId(), name, start, end, color });
      document.getElementById('newShiftName').value = '';
      renderShiftsList();
      renderRotationBuilder();
      showToast(`Turno "${name}" agregado.`);
    });

    document.getElementById('shiftsList').addEventListener('click', e => {
      const item = e.target.closest('.shift-config-item');
      if (!item) return;
      const idx = parseInt(item.dataset.idx, 10);

      if (e.target.closest('.shift-edit-save')) { finishShiftEdit(item, true); return; }
      if (e.target.closest('.shift-edit-cancel')) { finishShiftEdit(item, false); return; }

      const editBtn = e.target.closest('.btn-edit-shift');
      if (editBtn && !item.dataset.editing) { startShiftEdit(item); return; }

      const moveBtn = e.target.closest('.btn-move-shift');
      if (moveBtn) {
        moveShift(idx, parseInt(moveBtn.dataset.dir, 10));
        renderShiftsList();
        renderRotationBuilder();
        return;
      }

      const btn = e.target.closest('.btn-delete-shift');
      if (!btn) return;
      const shiftId = state.shifts[idx].id;
      const shiftName = state.shifts[idx].name;
      // Clean references from rotation pattern
      state.rotation.pattern.forEach(row => {
        for (let i = 0; i < row.length; i++) {
          if (row[i] === shiftId) row[i] = null;
        }
      });
      state.shifts.splice(idx, 1);
      renderShiftsList();
      renderRotationBuilder();
      showToast(`Turno "${shiftName}" eliminado.`);
    });

    // ---- Staff Tab ----
    document.getElementById('addPrimaryStaffBtn').addEventListener('click', () => {
      const name = document.getElementById('newPrimaryStaffInput').value.trim().toUpperCase();
      if (!name) { showToast('Ingresa el nombre del titular.', 'error'); return; }
      if (state.staff.primary.includes(name)) { showToast('Ya existe ese titular.', 'error'); return; }
      state.staff.primary.push(name);
      state.rotation.pattern.push(new Array(patternWidth()).fill(null));
      document.getElementById('newPrimaryStaffInput').value = '';
      renderPrimaryStaffList();
      renderRotationBuilder();
      populateTechSelects();
      showToast(`Titular "${name}" agregado.`);
    });

    document.getElementById('primaryStaffList').addEventListener('click', e => {
      const item = e.target.closest('.staff-item');
      if (!item) return;
      const idx = parseInt(item.dataset.idx, 10);

      if (e.target.closest('.staff-edit-save')) { finishInlineEdit(item, 'primary', true); return; }
      if (e.target.closest('.staff-edit-cancel')) { finishInlineEdit(item, 'primary', false); return; }

      const editBtn = e.target.closest('.btn-edit-primary');
      if (editBtn && !item.dataset.editing) { startInlineEdit(item, 'primary'); return; }

      const moveBtn = e.target.closest('.btn-move-primary');
      if (moveBtn) {
        movePerson('primary', idx, parseInt(moveBtn.dataset.dir, 10));
        renderPrimaryStaffList();
        renderRotationBuilder();
        populateTechSelects();
        return;
      }

      const btn = e.target.closest('.btn-delete-primary');
      if (!btn) return;
      const name = state.staff.primary[idx];
      state.staff.primary.splice(idx, 1);
      state.rotation.pattern.splice(idx, 1);
      renderPrimaryStaffList();
      renderRotationBuilder();
      populateTechSelects();
      showToast(`Titular "${name}" eliminado.`);
    });

    document.getElementById('addExternalTechBtn').addEventListener('click', () => {
      const name = document.getElementById('newExternalTechInput').value.trim().toUpperCase();
      if (!name) { showToast('Ingresa el nombre del externo.', 'error'); return; }
      if (state.staff.external.includes(name)) { showToast('Ya existe ese externo.', 'error'); return; }
      state.staff.external.push(name);
      document.getElementById('newExternalTechInput').value = '';
      renderExternalTechsList();
      populateTechSelects();
      showToast(`Externo "${name}" agregado.`);
    });

    document.getElementById('externalTechsListContainer').addEventListener('click', e => {
      const item = e.target.closest('.staff-item');
      if (!item) return;
      const idx = parseInt(item.dataset.idx, 10);

      if (e.target.closest('.staff-edit-save')) { finishInlineEdit(item, 'external', true); return; }
      if (e.target.closest('.staff-edit-cancel')) { finishInlineEdit(item, 'external', false); return; }

      const editBtn = e.target.closest('.btn-edit-ext');
      if (editBtn && !item.dataset.editing) { startInlineEdit(item, 'external'); return; }

      const moveBtn = e.target.closest('.btn-move-ext');
      if (moveBtn) {
        movePerson('external', idx, parseInt(moveBtn.dataset.dir, 10));
        renderExternalTechsList();
        return;
      }

      const btn = e.target.closest('.btn-delete-ext');
      if (!btn) return;
      const name = state.staff.external[idx];
      state.staff.external.splice(idx, 1);
      renderExternalTechsList();
      populateTechSelects();
      showToast(`Externo "${name}" eliminado.`);
    });

    // ---- Rotation Tab ----
    document.getElementById('applyCycleLengthBtn').addEventListener('click', () => {
      const newLen = parseInt(document.getElementById('cycleLengthInput').value, 10);
      if (isNaN(newLen) || newLen < 1 || newLen > 60) {
        showToast('El ciclo debe ser entre 1 y 60 días.', 'error'); return;
      }
      state.rotation.cycleLength = newLen;
      normalizePattern();
      renderRotationBuilder();
      showToast(`Ciclo ajustado a ${newLen} días.`);
    });

    document.getElementById('baseDateInput').addEventListener('change', e => {
      state.rotation.baseDateStr = e.target.value;
    });

    // ---- Rotation mode (fijo / mensual) ----
    const rotationModeSelect = document.getElementById('rotationModeSelect');
    if (rotationModeSelect) {
      rotationModeSelect.addEventListener('change', e => setRotationMode(e.target.value));
    }
    const monthWeekChecks = document.getElementById('monthWeekChecks');
    if (monthWeekChecks) {
      monthWeekChecks.addEventListener('change', e => {
        const cb = e.target.closest('input[data-week]');
        if (!cb) return;
        const w = parseInt(cb.dataset.week, 10);
        if (state.rotation.monthChecks && state.rotation.monthChecks.length === 4) {
          state.rotation.monthChecks[w] = cb.checked;
          renderRotationBuilder();
        }
      });
    }

    // ---- Save Config ----
    document.getElementById('saveConfigBtn').addEventListener('click', () => {
      // Read base date from input
      const bdInput = document.getElementById('baseDateInput');
      if (bdInput && bdInput.value) state.rotation.baseDateStr = bdInput.value;

      saveConfig();
      populateTechSelects();
      closeConfigModal();
      renderAll();
      showToast('✅ Configuración guardada.');
    });

    // ---- Reset Defaults ----
    document.getElementById('resetDefaultsBtn').addEventListener('click', () => {
      if (!confirm('¿Restaurar los valores por defecto? Se perderá la configuración actual de turnos, personal y rotación.')) return;
      const fresh = buildDefaultConfig();
      state.shifts   = fresh.shifts;
      state.staff    = fresh.staff;
      state.rotation = fresh.rotation;
      renderShiftsList();
      renderPrimaryStaffList();
      renderExternalTechsList();
      renderRotationBuilder();
      showToast('Valores por defecto restaurados.');
    });

    // ---- Print ----
    document.getElementById('printBtn').addEventListener('click', () => window.print());

    // ---- Swap Form ----
    document.getElementById('swapForm').addEventListener('submit', e => {
      e.preventDefault();
      const dateKey  = document.getElementById('swapDate').value;
      const origPerson = document.getElementById('swapTechA').value;
      const replacement = document.getElementById('swapTechB').value;
      const reason   = document.getElementById('swapReason').value.trim();
      const fromTime = document.getElementById('swapFromTime').value;
      const toTime   = document.getElementById('swapToTime').value;

      if (!dateKey || !origPerson || !replacement) {
        showToast('Completa los campos requeridos.', 'error'); return;
      }
      if (origPerson === replacement) {
        showToast('El titular y el reemplazo no pueden ser la misma persona.', 'error'); return;
      }
      if (fromTime && !toTime) {
        showToast('Si ingresas hora de inicio parcial, debes ingresar hora de fin también.', 'error'); return;
      }

      const data = { replacement, reason, fromTime: fromTime || null, toTime: toTime || null };

      if (swapEditing) {
        // MODIFICAR un reemplazo existente
        const oldKey = swapEditing.dateKey, oldPerson = swapEditing.person;
        if ((oldKey !== dateKey || oldPerson !== origPerson) &&
            state.swaps[dateKey] && state.swaps[dateKey][origPerson]) {
          showToast('Ya existe un reemplazo para esa fecha/titular. Usa el botón de modificar de esa fila.', 'error'); return;
        }
        if (oldKey !== dateKey || oldPerson !== origPerson) {
          if (state.swaps[oldKey]) {
            delete state.swaps[oldKey][oldPerson];
            if (Object.keys(state.swaps[oldKey]).length === 0) delete state.swaps[oldKey];
          }
        }
        if (!state.swaps[dateKey]) state.swaps[dateKey] = {};
        state.swaps[dateKey][origPerson] = data;
        swapEditing = null;
        updateSwapFormMode(false);
        showToast(`✅ Reemplazo actualizado para ${dateKey}.`);
      } else {
        // Registrar nuevo
        if (state.swaps[dateKey] && state.swaps[dateKey][origPerson]) {
          showToast('Ya existe un reemplazo para este día y titular. Pulsa el lápiz de esa fila para modificarlo.', 'error'); return;
        }
        if (!state.swaps[dateKey]) state.swaps[dateKey] = {};
        state.swaps[dateKey][origPerson] = data;
        showToast(`✅ Reemplazo registrado para ${dateKey}.`);
      }

      saveConfig();
      populateTechSelects();
      renderAll();
      const heading = document.querySelector('.swap-form-card h3');
      if (heading) heading.innerHTML = '<i class="fa-solid fa-right-left"></i> Registrar Reemplazo o Cambio de Turno';
      document.getElementById('swapCancelEditBtn').style.display = 'none';
      // Reset partial time + reason fields
      document.getElementById('swapFromTime').value = '';
      document.getElementById('swapToTime').value   = '';
      document.getElementById('swapReason').value   = '';
    });

    // Swap edit (delegated)
    document.getElementById('swapsTableBody').addEventListener('click', e => {
      const editBtn = e.target.closest('.btn-edit-swap');
      if (editBtn) {
        startSwapEdit(editBtn.dataset.date, editBtn.dataset.person);
        return;
      }
      const btn = e.target.closest('.btn-delete-swap');
      if (!btn) return;
      const dateKey = btn.dataset.date;
      const person  = btn.dataset.person;
      if (state.swaps[dateKey]) {
        delete state.swaps[dateKey][person];
        if (Object.keys(state.swaps[dateKey]).length === 0) delete state.swaps[dateKey];
      }
      if (swapEditing && swapEditing.dateKey === dateKey && swapEditing.person === person) {
        swapEditing = null;
        updateSwapFormMode(false);
      }
      saveConfig();
      renderAll();
      showToast('Reemplazo eliminado.');
    });

    // Cancel swap edit
    document.getElementById('swapCancelEditBtn').addEventListener('click', cancelSwapEdit);

    // Clear all swaps
    document.getElementById('clearAllSwapsBtn').addEventListener('click', () => {
      if (!confirm('¿Eliminar TODOS los reemplazos registrados?')) return;
      state.swaps = {};
      saveConfig();
      renderAll();
      showToast('Todos los reemplazos eliminados.');
    });
  }

  // ==========================================
  // NUBE — Firestore (datos compartidos por el link)
  // ==========================================
  let cloudDb = null;

  function cloudReady() {
    return !!(CLOUD_CONFIG && CLOUD_CONFIG.projectId && CLOUD_CONFIG.apiKey);
  }

  function cloudDoc() {
    if (!cloudReady()) return null;
    if (!cloudDb) {
      if (!firebase.apps.length) firebase.initializeApp(CLOUD_CONFIG);
      cloudDb = firebase.firestore();
    }
    return cloudDb.collection('horarios_tpg').doc('instancia_principal');
  }

  function tsToMillis(t) {
    if (t && typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t === 'number') return t;
    return 0;
  }

  function buildCloudEnvelope() {
    const yardsData = {};
    YARD_IDS.forEach(id => {
      let config = null, swaps = null;
      try {
        const c = localStorage.getItem(`${STORAGE_KEY}_${id}`);
        if (c) config = JSON.parse(c);
        const s = localStorage.getItem(`${STORAGE_SWAPS_KEY}_${id}`);
        if (s) swaps = JSON.parse(s);
      } catch (e) { /* ignore */ }
      yardsData[id] = { config, swaps };
    });
    return {
      v: 1,
      yards: YARD_IDS,
      yardsActive: Object.assign({}, state.yardsActive),
      yardColors: Object.assign({}, state.yardColors),
      activeYard: state.activeYard,
      yardsData
    };
  }

  function pushToCloud() {
    try {
      if (typeof firebase === 'undefined') {
        showToast('El SDK de Firebase no se cargó (revisa conexión a internet y bloqueadores).', 'error');
        return;
      }
      if (!cloudReady()) {
        showToast('La nube aún no está configurada: crea el proyecto Firebase y pega su config en CLOUD_CONFIG (app.js).', 'error');
        return;
      }
      const doc = cloudDoc();
      if (!doc) return;
      saveConfig();
      doc.set({
        payload: JSON.stringify(buildCloudEnvelope()),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }).then(() => {
        const now = Date.now();
        localStorage.setItem('cloudLastApplied', String(now));
        updateCloudStatus('En la nube · ' + new Date(now).toLocaleTimeString());
        showToast('Datos subidos a la nube. Los demás verán esta versión al abrir el link.');
      }).catch(err => {
        console.error('[pushToCloud]', err);
        let msg = 'Error subiendo a la nube (revisa que exista la base Firestore y las reglas).';
        if (err && err.message) msg += ' ' + err.message;
        showToast(msg, 'error');
      });
    } catch (e) {
      console.error('[pushToCloud]', e);
      showToast('Error al conectar con Firebase: ' + (e && e.message ? e.message : e), 'error');
    }
  }

  function applyCloudData(data) {
    try {
      const ts = tsToMillis(data.updatedAt);
      const env = typeof data.payload === 'string' ? JSON.parse(data.payload) : data;
      if (env.yards && Array.isArray(env.yards)) {
        env.yards.forEach(id => {
          const d = env.yardsData && env.yardsData[id];
          if (!d) return;
          if (d.config) localStorage.setItem(`${STORAGE_KEY}_${id}`, JSON.stringify(d.config));
          if (d.swaps) localStorage.setItem(`${STORAGE_SWAPS_KEY}_${id}`, JSON.stringify(d.swaps));
        });
      }
      localStorage.setItem(STORAGE_YARDS_KEY, JSON.stringify({
        yards: env.yards,
        yardsActive: env.yardsActive,
        yardColors: env.yardColors,
        activeYard: env.activeYard
      }));
      if (ts > 0) localStorage.setItem('cloudLastApplied', String(ts));
    } catch (e) { console.error('applyCloudData:', e); }
  }

  function hasLocalData() {
    return Object.keys(localStorage).some(k => k.indexOf(STORAGE_KEY) === 0);
  }

  function updateCloudStatus(content, mode) {
    const el = document.getElementById('cloudStatus');
    if (!el) return;
    el.style.display = 'inline-flex';
    el.className = 'cloud-status' + (mode === 'update' ? ' cloud-update' : '');
    el.innerHTML = content;
  }

  function checkRemoteUpdate(data, remoteTs, lastApplied) {
    if (remoteTs > lastApplied) {
      updateCloudStatus('En la nube: versión ' + new Date(remoteTs).toLocaleTimeString() + ' <button id="cloudApplyBtn" type="button">Aplicar</button>', 'update');
    } else if (remoteTs > 0) {
      updateCloudStatus('Al día · ' + new Date(remoteTs).toLocaleTimeString());
    }
  }

  function applyRemoteNow() {
    try {
      const doc = cloudDoc();
      if (!doc) return;
      doc.get().then(snap => {
        if (!snap.exists) return;
        const data = snap.data();
        applyCloudData(data);
        location.reload();
      }).catch(err => console.error('applyRemoteNow:', err));
    } catch (e) { console.error('applyRemoteNow:', e); }
  }

  function startCloudSync() {
    try {
      if (!cloudReady() || typeof firebase === 'undefined') return;
      const doc = cloudDoc();
      if (!doc) return;
      doc.get().then(snap => {
        if (!snap.exists) return;
        const data = snap.data();
        const remoteTs = tsToMillis(data.updatedAt);
        const lastApplied = parseInt(localStorage.getItem('cloudLastApplied') || '0', 10) || 0;
        if (!hasLocalData() && remoteTs > 0) {
          applyCloudData(data);
          location.reload();
          return;
        }
        checkRemoteUpdate(data, remoteTs, lastApplied);
      }).catch(err => console.error('Error leyendo nube:', err));

      doc.onSnapshot(snap => {
        if (!snap.exists) return;
        const data = snap.data();
        const remoteTs = tsToMillis(data.updatedAt);
        const lastApplied = parseInt(localStorage.getItem('cloudLastApplied') || '0', 10) || 0;
        checkRemoteUpdate(data, remoteTs, lastApplied);
      });
    } catch (e) { console.error('startCloudSync:', e); }
  }

  // ==========================================
  // ARRANQUE
  // ==========================================
  document.addEventListener('DOMContentLoaded', init);

})();
