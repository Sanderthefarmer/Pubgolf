// Instellingen voor de Pubgolf-app.
//
// db:   de URL van je Firebase Realtime Database, bijvoorbeeld
//       'https://mijn-project-default-rtdb.europe-west1.firebasedatabase.app'
//       Laat leeg om de URL in de app zelf te plakken (hij komt dan in de uitnodigingslink).
// editMinutes: hoeveel minuten spelers hun eigen opgeslagen score nog mogen aanpassen.
//       Daarna kan alleen de organisator dat. 0 = direct op slot.
// game: laat leeg, dan opent de link de lobby waar iedereen een eigen spel kan starten
//       of met een spelcode kan meedoen. Vul je hier een spelcode in, dan opent de
//       link altijd direct dat ene spel.
window.PUBGOLF_CONFIG = {
  db: 'https://pubgolf-11b08-default-rtdb.europe-west1.firebasedatabase.app',
  game: '',
  editMinutes: 2
};
