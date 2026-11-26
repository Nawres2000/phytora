# PHYTORA : diagnostic des maladies foliaires, de l'entraînement à la production

**Projets de modules Deep Learning Avancé (Axe 1, CNN & Transfer Learning) et MLOps.** Classification de 38 maladies foliaires (PlantVillage) avec un MobileNetV3 affiné. Le projet couvre tout le cycle MLOps :
- données et modèles versionnés avec DVC (remote DagsHub), entraînements suivis dans MLflow, avec Model Registry ;
- orchestration **Prefect** : réentraînement planifié, ingestion de données, gestion des erreurs et rollback ;
- export ONNX, puis quantification INT8 et FP16 ;
- API FastAPI typée, application web Next.js avec un assistant agronomique ;
- **monitoring** : métriques Prometheus, tableau de bord Grafana, alertes, dérive mesurée avec Evidently ;
- CI, **CD** (GHCR, staging, prod, rollback) et **CT** (réentraînement automatique) avec GitHub Actions.

Documentation : [guide de déploiement](docs/DEPLOYMENT.md) · [rapport de monitoring](docs/MONITORING.md) · [plan de la validation MLOps](docs/VALIDATION.md)

```
Navigateur ──HTTP──▶ Frontend Next.js (3000) ──JSON──▶ Passerelle Express (5000) ──multipart──▶ API FastAPI (8000) ──▶ ONNX Runtime
                                                  │  comptes, historique, chatbot RAG                 │  /docs Swagger
                                                  └──▶ MongoDB                                         └──▶ PyTorch (Grad-CAM)
DVC (données + poids) ──▶ src/ (prepare → train → evaluate → export → reference) ──▶ MLflow (runs + Model Registry, 5001)
        ▲                               ▲ orchestré par Prefect (4200) : training-pipeline · monitoring-check · ingest-new-data
        │                               │
   data/incoming            logs JSON des prédictions ──▶ dérive Evidently ──▶ réentraînement (CT)
API /metrics ──▶ Prometheus (9090, alertes) ──▶ Grafana (3001)
GitHub Actions : CI (lint, tests) ──▶ CD (GHCR → staging → prod, rollback) · CT (dvc exp run sur nouvelles données / dérive)
```

## Démarrage en une commande

```bash
dvc pull                       # récupère les poids du modèle (models/legacy) depuis le remote DVC
cp .env.example .env           # clé Groq pour l'assistant, JWT_SECRET, e-mails admin
docker compose up --build
```

| Service | URL |
|---|---|
| Application web | http://localhost:3000 |
| API FastAPI (Swagger) | http://localhost:8000/docs |
| MLflow (runs, registre) | http://localhost:5001 |
| Prefect (flows, exécutions) | http://localhost:4200 |
| Prometheus (métriques, alertes) | http://localhost:9090 |
| Grafana (tableau de bord, admin / admin) | http://localhost:3001 |
| Passerelle (santé) | http://localhost:5000/health |

Sans poids du modèle, `MOCK=1 docker compose up --build` sert des prédictions aléatoires bien formées, marquées « démonstration ». C'est ce mode qu'utilise la CI.

## Arborescence

```
.github/workflows/   ci-tests.yml (lint + pytest + node:test + build web), docker-build.yml (images + test docker compose)
data/                raw/ et processed/ : versionnés par DVC, jamais par Git
src/                 code Deep Learning et MLOps
  data/              download.py, prepare.py (anti-fuite), dataset.py, augment.py (MixUp/CutMix)
  models/            architecture.py, losses.py (Focal), train.py (MLflow), evaluate.py, export.py (ONNX/INT8/FP16 + registre), compare.py
  utils/             gradcam.py (Grad-CAM, Score-CAM), severity.py, common.py
  monitoring/        features.py (descripteurs d'image), reference.py, drift.py (Evidently)
  pipelines/         flows.py (flows Prefect), serve.py (déploiements planifiés)
backend/             API FastAPI : app/main.py (routes), app/schemas.py (Pydantic), app/inference.py (ONNX Runtime), tests/, Dockerfile
gateway/             Express + MongoDB : comptes, historique, retours utilisateurs, chatbot (streaming SSE + RAG), administration
notebooks/           notebooks Kaggle d'origine (entraînement baseline/MobileNet, Grad-CAM + ONNX), portés dans src/
configs/             prometheus/ (scrape + alertes), grafana/ (datasource + dashboard provisionnés)
docker/              train.Dockerfile (entraînement + Prefect)
docs/                déploiement, monitoring, plan de validation
scripts/             smoke_test.sh, deploy.sh, rollback.sh
frontend/            Next.js + Tailwind : dépôt d'image, webcam en direct, Grad-CAM, sévérité, latences, page Modèle, assistant
models/              legacy.dvc (modèle actuel) + sorties du pipeline (model.pt, model*.onnx, metadata.json)
tests/               tests unitaires du pipeline (pytest)
dvc.yaml, params.yaml   pipeline reproductible et hyperparamètres
docker-compose.yml   mongo, mlflow, backend, gateway, frontend
report/              rapport technique LaTeX
```

> Écart assumé avec l'arborescence type : le frontend appelle une **passerelle Express** et non FastAPI directement. La passerelle gère l'authentification, l'historique MongoDB et le chatbot, et laisse FastAPI se concentrer sur l'inférence. L'API FastAPI reste exposée et documentée sur le port 8000.

## 1. Données et modélisation (`src/`, DVC, MLflow)

```bash
pip install -r requirements-train.txt
python -m src.data.download          # Kaggle abdallahalidev/plantvillage-dataset → data/raw/plantvillage/color
dvc add data/raw/plantvillage && dvc push
dvc repro                            # prepare → train → evaluate → export (ne relance que ce qui a changé)
dvc metrics show && dvc plots show
mlflow ui --backend-store-uri sqlite:///mlflow.db   # ou le serveur MLflow de docker compose
```

**Comparer des architectures et des stratégies** (chaque expérience devient un run MLflow) :

```bash
dvc exp run -S train.model=baseline_cnn
dvc exp run -S train.model=mobilenet_v3_small
dvc exp run -S train.model=efficientnet_v2_s
dvc exp run -S train.loss=focal -S train.mix=cutmix -S train.randaugment=true
python -m src.models.compare         # → reports/comparison.md
```

Sur GPU Kaggle ou Colab, définissez `MLFLOW_TRACKING_URI` vers votre serveur MLflow (par exemple DagsHub) pour retrouver les runs ensuite.

| Étape | Contenu |
|---|---|
| `prepare` | MD5, puis retrait des étiquettes contradictoires et des doublons exacts. Regroupement des quasi-doublons (dHash), puis split stratifié 70/15/15 **par groupe**. Contrôle qu'aucun contenu ne se retrouve dans deux splits. |
| `train` | Transfer learning en 2 phases : tête seule, puis derniers blocs dégelés. BatchNorm figées, AdamW, cosine, AMP. Pertes : CE pondérée ou Focal Loss. MixUp, CutMix, RandAugment. Meilleur epoch retenu sur le F1 macro de validation. |
| `evaluate` | Évaluation unique sur le test : exactitude, F1 macro et pondéré, top-3, rapport par classe, matrice de confusion, confusions principales. |
| `export` | ONNX FP32 (parité vérifiée < 1e-3), FP16, puis **INT8 statique mixte guidé par la sensibilité**. Banc de mesure (taille, latence, exactitude). Enregistrement dans le registre MLflow (alias `staging` ; promu en `production` s'il bat le modèle en place). |

**Résultats du modèle servi** (MobileNetV3-Small, test PlantVillage) : **98,8 %** d'exactitude, **98,3 %** de F1 macro. La baseline CNN atteint 95,5 % et 94,2 %.

Export mesuré sur CPU, 1 image :

| Variante | Taille | Latence | Exactitude* |
|---|---|---|---|
| PyTorch | 6,4 Mo | 5,7 ms | – |
| ONNX FP32 | 6,2 Mo | 1,5 ms | 99,1 % |
| ONNX INT8 | 1,9 Mo | 1,9 ms | 98,2 % |
| ONNX FP16 | 3,2 Mo | 7,5 ms | 99,1 % |

\*Mesurée sur 225 images PlantVillage (15 classes), indépendantes de celles de calibration.

**Pourquoi un INT8 « mixte » ?** Quantifier toutes les couches faisait tomber l'exactitude à 4 %. Le BatchNorm fusionné laisse quelques canaux des premières couches avec des plages énormes, et une seule échelle par tenseur écrase les autres canaux. `export.py` quantifie donc chaque couche isolément, mesure la dérive des logits, et garde en FP32 les couches les plus sensibles jusqu'à 98 % d'accord avec FP32. Ici, 4 couches sur 54 restent en FP32.

**Limites** :
- PlantVillage contient des photos de laboratoire (feuille seule, fond uni). Au champ, la performance sera plus basse.
- Le Grad-CAM montre que le modèle regarde parfois le fond.
- Le dHash ne regroupe que les quasi-copies, pas plusieurs photos d'une même feuille : le score de test reste probablement optimiste.

## 2. API FastAPI (`backend/`)

```bash
pip install -r backend/requirements.txt -r backend/requirements-explain.txt
uvicorn backend.app.main:app --port 8000      # depuis la racine du dépôt
```

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/health` | état, GPU (fournisseurs ONNX Runtime), version du modèle, explicabilité disponible |
| GET | `/model/metadata` | architecture, classes, métriques val/test, benchmark baseline, variantes ONNX |
| POST | `/predict` | top-k, incertitude, sévérité, Grad-CAM optionnel (`explain=true`, `method=gradcam\|scorecam`), latences détaillées |
| POST | `/predict/visualize` | PNG annoté : `overlay=gradcam\|scorecam\|severity` |
| POST | `/predict/batch` | jusqu'à 16 images |

Toutes les réponses sont validées par des schémas Pydantic stricts. Les erreurs renvoient des codes HTTP explicites :
- 400 : fichier qui n'est pas une image ;
- 413 : image trop grande ;
- 422 : paramètres invalides ;
- 501 : explicabilité indisponible ;
- 503 : modèle non chargé.

Variables d'environnement : `MODEL_DIR`, `ONNX_VARIANT` (fp32, int8 ou fp16), `MIN_CONFIDENCE`, `MIN_MARGIN`, `MOCK`.

## 3. Application web et assistant

- **Ingestion** : glisser-déposer, galerie d'exemples, photo par webcam, et **diagnostic en direct** (une image toutes les 0,7 s, étiquette superposée au flux vidéo, images/s, latences client, serveur et modèle).
- **Résultat** :
  - barres de probabilité animées et carte Grad-CAM ;
  - **sévérité** (part de la feuille atteinte et masque des zones atteintes) ;
  - détail des temps de réponse : navigateur, passerelle, FastAPI, prétraitement, inférence, Grad-CAM ;
  - retour « diagnostic correct ? ».
- **Page « Modèle IA & MLOps »** : métriques, comparaison baseline/MobileNet, tableau PyTorch/ONNX FP32/FP16/INT8, mesure de latence en direct depuis le navigateur, liens Swagger et MLflow.
- **Assistant PHYTORA** (bulle flottante sur toutes les pages) :
  - réponses affichées au fil de l'eau (SSE), en Markdown ;
  - **réponses appuyées sur le guide des maladies (RAG)**, avec les sources citées ;
  - prise en compte du diagnostic de l'utilisateur et de sa sévérité ;
  - questions suggérées, envoi d'une photo dans le chat, dictée vocale ;
  - historique des conversations dans MongoDB, notes 👍/👎 résumées dans l'administration.

Développement sans Docker :

```bash
cd gateway && cp .env.example .env && npm ci && npm run dev
cd frontend && cp .env.example .env.local && npm ci && npm run dev
```

## 4. Orchestration, monitoring, CD et CT (module MLOps)

| Brique | Fichiers | Ce qui est en place |
|---|---|---|
| Orchestration Prefect | `src/pipelines/flows.py`, `serve.py`, `docker/train.Dockerfile` | 3 flows planifiés (entraînement le lundi, dérive toutes les 6 h, ingestion toutes les 30 min). Retries avec backoff et timeouts, fail-fast sur les erreurs déterministes, quality gate, **rollback** des artefacts, hooks d'alerte. |
| Monitoring | `backend/app/monitoring.py`, `src/monitoring/`, `configs/prometheus`, `configs/grafana` | `/metrics` (système et modèle), log JSON de chaque prédiction, dérive Evidently (descripteurs d'image, confiance, classes), 9 alertes Prometheus, tableau de bord Grafana provisionné |
| CD | `.github/workflows/cd.yml`, `scripts/deploy.sh`, `scripts/rollback.sh`, `scripts/smoke_test.sh` | images construites une fois, poussées sur GHCR (tag SHA), staging puis promotion en prod par retag, rollback automatique |
| CT | `.github/workflows/ct.yml`, flow `monitoring-check` | réentraînement sur nouvelles données, dérive, planification ou à la demande ; PR avec le nouveau `dvc.lock` |

Détails dans [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) et [docs/MONITORING.md](docs/MONITORING.md).

## 5. Qualité, tests et CI

```bash
pytest                                          # pipeline, monitoring, flows Prefect (23 tests) + API (19 tests)
flake8 src backend tests && black --check src backend tests
cd gateway && npm run lint && npm test          # 15 tests (auth, isolation, proxy modèle, chatbot SSE)
cd frontend && npm run lint && npm run build
```

GitHub Actions :
- `ci-tests.yml` : lint Python et vérification de `dvc.yaml`, pytest, lint et tests de la passerelle, lint et build du frontend ;
- `docker-build.yml` : build des 4 images (multi-stage), puis `docker compose up` et vérification de bout en bout : API, MLflow, Prefect (déploiements enregistrés), Prometheus (cible et règles), Grafana (tableau de bord) ;
- `cd.yml` et `ct.yml` : voir la section 4.

## Remote DVC

Le remote par défaut (`../phytora-dvc-storage`) est un dossier local. Pour partager les données et les poids dans l'équipe, configurez un remote commun :

```bash
dvc remote add -d -f storage gdrive://<id-du-dossier>            # ou s3://..., ou DagsHub
dvc push
```

Si `dvc pull` ne trouve pas `models/legacy`, régénérez-le depuis l'historique Git (commit initial), puis relancez l'export :

```bash
mkdir -p models/legacy
git show b94f93d:phytora/model-api/models/mobilenet_v3_small_best.pt > models/legacy/mobilenet_v3_small_best.pt
git show b94f93d:phytora/model-api/models/metrics.json > models/legacy/metrics.json
git show b94f93d:phytora/model-api/models/classes.json > models/legacy/classes.json
python -m src.models.export --checkpoint models/legacy/mobilenet_v3_small_best.pt --out models/legacy --images data/raw/plantvillage/color --no-mlflow
dvc add models/legacy && dvc push
```
