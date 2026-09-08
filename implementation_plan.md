# Plan de Implementación: Sistema Web de Generación de Horarios Rotativos (4 Técnicos 24/7)

## 1. Análisis del Patrón Rotativo (Descifrado del Excel)

De acuerdo a la imagen que compartiste de su Excel actual, el sistema maneja un **ciclo cerrado de rotación perfecta de 8 días (6 días de trabajo + 2 días libres)**:

```
🔄 Ciclo de 8 días por técnico:
[2 Días: 7-15] ➡️ [2 Días: 15-23] ➡️ [2 Días: 23-7] ➡️ [2 Días: LIBRE]
```

### Desfase de los 4 Técnicos (Cobertura 24/7 sin huecos)
Tomando como base tu ejemplo del **01/09/2026**:
- **Día 1 y 2 (Ej: 01 y 02 Sept)**:
  - 🌅 **7-15**: LUIS
  - 🌇 **15-23**: DAU
  - 🌙 **23-7**: JORGE
  - 🟢 **LIBRE**: DIXON
- **Día 3 y 4 (Ej: 03 y 04 Sept)**:
  - 🌅 **7-15**: DIXON
  - 🌇 **15-23**: LUIS
  - 🌙 **23-7**: DAU
  - 🟢 **LIBRE**: JORGE
- **Día 5 y 6 (Ej: 05 y 06 Sept)**:
  - 🌅 **7-15**: JORGE
  - 🌇 **15-23**: DIXON
  - 🌙 **23-7**: LUIS
  - 🟢 **LIBRE**: DAU
- **Día 7 y 8 (Ej: 07 y 08 Sept)**:
  - 🌅 **7-15**: DAU
  - 🌇 **15-23**: JORGE
  - 🌙 **23-7**: DIXON
  - 🟢 **LIBRE**: LUIS
*(Y el ciclo se repite indefinidamente de forma matemática y exacta para cualquier mes o año).*

---

## 2. Propuesta de la Aplicación Web

Crearemos una aplicación web moderna, rápida, visualmente atractiva (Dark/Light mode premium, responsive y sin necesidad de instalar servidores complejos) ubicada en la carpeta `c:/Soporte TPG/pruebas py/HORARIOS`.

### Características Principales:
1. **Vista Diario / Lista Excel (idéntica a su formato actual)**:
   - Formato tabular con fecha, día de la semana, turno (7-15, 15-23, 23-7, LIBRE) y técnico asignado.
   - Resaltado de fines de semana y días festivos/libres.
2. **Vista Calendario Mensual / Anual Interactivo**:
   - Selector rápido de **Año** y **Mes** (genera desde 2024 hasta 2030+ al instante).
   - Cuadrícula de calendario visual donde cada día muestra los 3 turnos y quién descansa.
   - Vista Anual compacta (Heatmap/Matriz) para ver la proyección completa del año de cada técnico.
3. **Filtro Individual por Técnico**:
   - Cada técnico (Luis, Dau, Jorge, Dixon o nombres personalizados) puede seleccionar su nombre y ver **su propio calendario mensual/anual** (cuándo le toca noche, cuándo libra, etc.).
4. **Exportación y Reportes**:
   - 📊 **Exportar a Excel (.xlsx)** con formato exacto al de la empresa (con estilos y colores).
   - 🖨️ **Impresión / PDF optimizado** listo para imprimir o enviar por WhatsApp/correo.
5. **Configuración Dinámica**:
   - Posibilidad de cambiar los nombres de los 4 técnicos.
   - Ajuste de fecha de referencia inicial (para sincronizar cualquier cambio histórico).
   - Simulación o registro de **Cambios de Turno / Reemplazos** puntuales.
6. **Estadísticas Automáticas**:
   - Horas totales trabajadas por mes/año, conteo de noches, domingos trabajados y días libres.

---

## 3. Estructura de Archivos

Se desarrollará en `c:\Soporte TPG\pruebas py\HORARIOS/`:
- `index.html`: Estructura semántica, controles interactivos, navegación entre vistas (Lista Excel, Calendario Mensual, Matriz Anual, Vista Individual).
- `styles.css`: Diseño moderno UI con variables CSS, glassmorphism, paleta de colores ergonómica (distintivos por turno: Mañana/Tarde/Noche/Libre), soporte móvil y desktop.
- `app.js`: Motor matemático del ciclo de turnos, generación de calendarios, persistencia local (LocalStorage), exportador a Excel (usando SheetJS / XLSX).

---

## 4. Plan de Verificación

1. **Pruebas de algoritmo**: Comparar los días generados en Septiembre 2026 contra la captura exacta del usuario (01 al 06 de Septiembre de 2026) para asegurar 100% de coincidencia.
2. **Pruebas de cambio de año/mes**: Probar transiciones de fin de mes, años bisiestos (febrero 28/29) y salto anual.
3. **Pruebas de exportación**: Validar que la exportación a Excel (.xlsx) genere las filas exactas y la tabla compatible con Microsoft Excel.
4. **Verificación visual en navegador**: Probar interfaz y responsividad.
