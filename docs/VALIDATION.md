# Plan de la validation MLOps (Mme Gharsalli)

Démonstration structurée en suivant les 8 points du mail. Avant le passage : `docker compose up -d`, puis ouvrir les onglets ci-dessous.

| # | Point demandé | Quoi montrer | Où |
|---|---|---|---|
| 1 | Présentation générale | Problème (38 maladies foliaires), métrique (F1 macro), schéma d'architecture | README (schéma), http://localhost:3000 |
| 2 | Versioning code et données | Branches et commits Git ; `dvc dag`, `dvc status -c`, `models/legacy.dvc`, `data/raw/plantvillage.dvc`, remote DagsHub | Terminal, GitHub, DagsHub (onglet Files) |
| 3 | Expériences MLflow | Runs comparés (baseline et MobileNet, Focal, CutMix…), paramètres, courbes par epoch, artefacts (matrice de confusion, ONNX). La validation croisée apparaît comme un run parent « cv-… » avec un run par fold (moyenne ± écart-type) | http://localhost:5001 (ou le MLflow DagsHub), *Experiments > phytora-plantvillage > Compare*. Pour remplir MLflow : déploiement Prefect `experiment-grid` (ou le notebook Kaggle 03) |
| 4 | Model Registry | `phytora-classifier` : une version par expérience, alias `staging` / `production`, versions archivées quand un meilleur modèle est promu. Règle de promotion dans `src/models/export.py` (`register`) | MLflow > *Models* |
| 5 | Orchestration | 3 déploiements planifiés ; lancer `training-pipeline` ; montrer un run en échec (`DataValidationError` ou `QualityGateError`) suivi du rollback ; graphe des tâches et logs | http://localhost:4200 ; code `src/pipelines/flows.py` (`retries`, `exponential_backoff`, `timeout_seconds`, `rollback`, `on_failure`) |
| 6 | CI | `ci-tests.yml` : flake8, black, `dvc dag`, 38 tests pytest (unitaires ML, API, monitoring, flows), ESLint, 15 tests Node, build Next.js ; `docker-build.yml` : 4 images et test `docker compose` de bout en bout | GitHub > *Actions* |
| 7 | CD et CT | `cd.yml` : GHCR, staging, prod, rollback ; `ct.yml` : réentraînement sur nouvelles données, dérive ou planification ; `scripts/deploy.sh` et `scripts/rollback.sh` | GitHub > *Actions*, GHCR (*Packages*) |
| 8 | Monitoring | Grafana (système et modèle), alertes Prometheus, rapport Evidently, `/monitoring/drift` ; simuler une dérive (photos sombres), lancer `monitoring-check`, voir l'alerte et le réentraînement | http://localhost:3001, http://localhost:9090/alerts, `docs/MONITORING.md` |

## Avant la validation : remplir MLflow et le Registry
1. Pousser le dataset sur DVC (`dvc add data/raw/plantvillage`, puis `dvc push`).
2. Soit sur CPU : interface Prefect, puis *Deployments > experiment-grid > Run* (`quick_n=50`, environ 10 à 20 min), puis *cross-validation > Run*.
3. Soit sur GPU (meilleurs scores, dataset complet) : `notebooks/03_kaggle_gpu_training.ipynb`, qui journalise dans le MLflow DagsHub.
4. Vérifier dans MLflow : au moins 4 runs comparables, plus un run de validation croisée, et 3 ou 4 versions de `phytora-classifier` avec des alias.

## Scénario de bout en bout (10 min)
1. **Ingestion** : déposer des images dans `data/incoming/<classe>/`, lancer `ingest-new-data`. Les images corrompues partent en quarantaine, les bonnes sont versionnées par `dvc add` et `dvc push`.
2. **Entraînement** : `training-pipeline` (avec `quick_n` pour la démo). Suivre les tâches dans Prefect et le nouveau run dans MLflow.
3. **Déploiement** : la nouvelle version entre dans le Registry et l'API la recharge (`/admin/reload`). Vérifier dans « Modèle IA & MLOps » et Grafana (`phytora_model_info`).
4. **Prédiction** : diagnostic d'une photo sur http://localhost:3000, avec latences et Grafana qui bouge.
5. **Monitoring** : envoyer des photos sombres, lancer `monitoring-check`. Dérive détectée, alerte `DataDriftDetected`, réentraînement déclenché.

## Questions probables et réponses courtes
- **Pourquoi Prefect et pas Airflow ?** Les flows sont du Python pur (décorateurs), avec retries, timeouts et hooks natifs. Il suffit d'un seul conteneur serveur, sans scheduler, webserver ni base Postgres à gérer.
- **Comment reprendre après un échec ?** Les retries avec backoff gèrent les erreurs réseau. Le cache DVC fait qu'une relance saute les étapes déjà faites. Le rollback restaure le `dvc.lock` commité et les artefacts.
- **Comment éviter qu'un mauvais modèle passe en production ?** Par deux verrous : la quality gate (seuil de F1 macro sur le test) avant l'enregistrement, puis la promotion seulement si le modèle bat la version en production.
- **Comment détecter la dérive sans étiquettes ?** Par les descripteurs d'image (dérive des données) et par la confiance et le taux d'incertitude (indicateurs de dérive de concept). Les vraies étiquettes arrivent via le bouton « diagnostic correct ? ».
- **Rollback du déploiement ?** En CD, l'image `:prod` précédente est restaurée par son digest. En local, `scripts/rollback.sh`. Côté API, `/admin/reload` garde l'ancien modèle si le nouveau ne se charge pas.
