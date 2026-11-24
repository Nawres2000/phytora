# PHYTORA

Diagnostic des maladies foliaires (38 classes PlantVillage) et, à venir, détection de mauvaises herbes.

| dossier | rôle | port |
|---|---|---|
| `frontend/` | Next.js (App Router) + Tailwind 4 | 3000 |
| `backend/` | Express + MongoDB : comptes, e-mails, historique, retours utilisateurs, chatbot Groq, administration | 5000 |
| `model-api/` | FastAPI + PyTorch : MobileNetV3-Small (`models/mobilenet_v3_small_best.pt`) + Grad-CAM | 8000 |

## Lancer

1. **MongoDB** doit tourner (ou mettez une URI Atlas dans `MONGO_URI`).
2. **Modèle** : `cd model-api && pip install -r requirements.txt && uvicorn main:app --port 8000`
   (la première installation de PyTorch CPU est lourde). Au démarrage, la console doit afficher `Classifier loaded: mobilenet_v3_small-ep11-...`.
   Sans modèle chargé, `MOCK=1` (PowerShell : `$env:MOCK="1"; uvicorn main:app --port 8000`) renvoie des résultats aléatoires marqués « démonstration ».
3. **Backend** : `cd backend && copy .env.example .env` (renseignez `JWT_SECRET`, `GROQ_API_KEY`, `ADMIN_EMAILS`, SMTP) puis `npm i && npm run dev`
4. **Frontend** : `cd frontend && copy .env.example .env.local && npm i && npm run dev` → http://localhost:3000

Sans SMTP, les liens de confirmation et de réinitialisation s'affichent dans la console du backend.

## Le modèle

- MobileNetV3-Small affiné sur PlantVillage (38 classes, 54 284 images, split stratifié 70/15/15 après retrait des doublons exacts).
- Test : exactitude 98,8 %, F1 macro 98,3 % (baseline CNN : 95,5 % / 94,2 %).
- Classes les plus faibles : *Corn Cercospora/Gray leaf spot* (rappel 75 %, confondue 19 fois avec *Northern Leaf Blight*), *Tomato Target Spot* (confondue avec *Tomato healthy* 15 fois et avec *Spider mites* 9 fois).
- **Limite majeure** : PlantVillage = feuilles isolées, fond uni, photos de laboratoire. Sur des photos prises au champ, la performance sera nettement plus basse, et le split aléatoire (sans regroupement par feuille) rend probablement le score de test optimiste. Mesurez le modèle sur vos propres photos avant de communiquer un chiffre.
- Un classifieur répond toujours, même pour une photo qui n'est pas une feuille. Règle « incertain » : confiance < `MIN_CONFIDENCE` (0,60) ou écart entre les 2 premières hypothèses < `MIN_MARGIN` (0,10), réglables par variables d'environnement de `model-api`. Ces seuils sont des valeurs de départ, non calibrées : réglez-les avec des photos hors PlantVillage et des photos sans feuille.
- La carte Grad-CAM montre où le modèle regarde (méthode du notebook partie 2).
- Les retours « diagnostic correct ? » des utilisateurs sont enregistrés (collection `scans`) et résumés dans la page Administration : base d'un jeu de données de terrain.

## Sécurité et tests

- `helmet`, limitation de débit (connexion, inscription, mot de passe oublié, analyses, chat), vérification du type réel de l'image (octets d'en-tête), taille max 8 Mo, validation des variables d'environnement au démarrage.
- `cd backend && npm test` : tests unitaires (mot de passe, détection du type d'image, catalogue des 38 classes) et tests d'intégration (inscription, confirmation e-mail, isolation des analyses entre utilisateurs, accès admin, compte désactivé). Les tests d'intégration utilisent `mongodb-memory-server`, qui télécharge un binaire MongoDB au premier lancement.

## Pas encore fait

« Mes cultures », détection de mauvaises herbes (aucun modèle), export PDF, pages de confidentialité / conditions, Docker Compose et CI, PWA, historique du chat.
