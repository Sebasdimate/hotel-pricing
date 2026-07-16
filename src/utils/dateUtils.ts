/**
 * Determina si una fecha corresponde a un fin de semana.
 * @param date Instancia de Date o string convertible a fecha
 */
export function isWeekend(date: Date | string): boolean {
  const d = new Date(date);
  const day = d.getDay(); // 0 = domingo, 6 = sábado
  return day === 0 || day === 6;
}

/**
 * Determina si una fecha es festivo según una lista predefinida.
 * Puedes reemplazar este arreglo por una consulta a BD si lo prefieres.
 */
const HOLIDAYS: string[] = [
  "2025-01-01", // Año Nuevo
  "2025-03-24", // Día de San José
  "2025-04-17", // Jueves Santo
  "2025-04-18", // Viernes Santo
  "2025-05-01", // Día del Trabajo
  "2025-05-29", // Ascensión del Señor
  "2025-06-19", // Corpus Christi
  "2025-06-26", // Sagrado Corazón
  "2025-07-20", // Independencia
  "2025-08-07", // Batalla de Boyacá
  "2025-08-18", // Asunción de la Virgen
  "2025-10-13", // Día de la Raza
  "2025-11-03", // Todos los Santos
  "2025-11-17", // Independencia de Cartagena
  "2025-12-08", // Inmaculada Concepción
  "2025-12-25", // Navidad
];

/**
 * Determina si una fecha es festivo en Colombia (según lista definida).
 * @param date Instancia de Date o string
 */
export function isHoliday(date: Date | string): boolean {
  const d = new Date(date);
  const dateString = d.toISOString().split("T")[0];
  return HOLIDAYS.includes(dateString);
}


export function formatDate(date: Date) {
  return date.toISOString().split("T")[0];
}

export function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function addMonths(date: Date, months: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}