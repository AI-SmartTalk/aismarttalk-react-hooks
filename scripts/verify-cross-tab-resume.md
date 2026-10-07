# Vérification navigateur de la reprise entre onglets

Après `npm run build`, lancer `node scripts/verify-cross-tab-resume.cjs` avec
Puppeteer disponible. Il peut provenir d'un environnement de test existant via
`PUPPETEER_MODULE=/chemin/vers/node_modules/puppeteer` ; aucune dépendance runtime
n'est ajoutée au SDK.

Le script utilise le hook compilé, deux onglets Chromium partageant réellement
localStorage et une API HTTP locale. Il vérifie le refus d'une API ignorant la
reprise, la convergence de deux premières ouvertures simultanées, la stabilité
des appels, le rechargement et la propagation d'une nouvelle conversation.

Options :

- `BASELINE_SDK_ESM=/chemin/vers/ancien/dist/index.esm.js` : reproduire aussi la
  boucle de l'ancien SDK contre l'ancienne API (testé avec 1.6.3).
- `RESUME_REPORT_PATH=/chemin/rapport.json` : enregistrer les mesures.

L'API de ce test est une simulation du contrat de création/reprise, pas le serveur
production. Les tests unitaires API dans aismarttalk couvrent les admissions et
refus d'accès. L’admission est sérialisée entre onglets via Web Locks lorsque cette API est
disponible (contexte sécurisé, notamment HTTPS et localhost). Sans Web Locks,
les contrôles d’accès et la convergence restent actifs, mais deux premières
ouvertures simultanées peuvent créer deux conversations avant de converger.


`node scripts/verify-cross-tab-logout.cjs` vérifie avec le SDK compilé et trois
onglets Chromium déjà authentifiés par le site : déconnexion propagée même sans
clé utilisateur préexistante, une seule nouvelle conversation visiteur, aucun
rattachement depuis une sélection reçue, aucun appel au repos, puis auto-login
au rechargement reprenant et rattachant exactement cette conversation. L’API
HTTP de ce scénario simule les admissions et conserve un message visiteur pour
vérifier qu’il n’est pas perdu au rechargement.
