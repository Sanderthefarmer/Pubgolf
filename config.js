// Instellingen voor de Pubgolf-app.
//
// db:   de URL van je Firebase Realtime Database, bijvoorbeeld
//       'https://mijn-project-default-rtdb.europe-west1.firebasedatabase.app'
//       Laat leeg om de URL in de app zelf te plakken (hij komt dan in de uitnodigingslink).
// editMinutes: hoeveel minuten spelers hun eigen opgeslagen score nog mogen aanpassen.
//       Daarna kan alleen de organisator dat. 0 = direct op slot.
// game: naam van het spel binnen de database. Verander dit voor een nieuwe avond
//       met een schone lei, bijvoorbeeld 'zwolle-2026'.
window.PUBGOLF_CONFIG = {
  db: '',
  game: 'zwolle',
  editMinutes: 2
};
