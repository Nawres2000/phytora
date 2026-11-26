# Guide de déploiement pas à pas

## 0. Prérequis
- Docker Desktop (Windows / macOS) ou Docker Engine + Compose v2 (Linux), 8 Go de RAM recommandés.
- Git, Python 3.11+ (pour DVC en local), un compte DagsHub (remote DVC) et une clé Groq (assistant).

## 1. Récupérer le code, les données et le modèle
```bash
git clone https://github.com/Nawres2000/phytora.git && cd phytora
python -m venv .venv && .venv\Scripts\activate        # Linux/macOS : source .venv/bin/activate
pip install "dvc[s3]"
dvc remote modify origin --local access_key_id <TOKEN_DAGSHUB>
dvc remote modify origin --local secret_access_key <TOKEN_DAGSHUB>
dvc pull                                              # modèle (models/legacy) + dataset (data/raw)
```

## 2. Configurer
```bash
copy .env.example .env        # Linux/macOS : cp
```
Renseigner au minimum : `JWT_SECRET` (≥ 32 caractères), `GROQ_API_KEY`, `GROQ_MODEL`, `ADMIN_EMAILS`, `ADMIN_TOKEN`.

## 3. Environnement de développement (build depuis les sources)
```bash
docker compose up --build
```

| Service | URL | Rôle |
|---|---|---|
| Application web | http://localhost:3000 | Diagnostic, webcam, assistant |
| API FastAPI | http://localhost:8000/docs | Swagger, `/metrics`, `/monitoring/drift` |
| MLflow | http://localhost:5001 | Expériences et Model Registry |
| Prefect | http://localhost:4200 | Flows, planifications, exécutions |
| Prometheus | http://localhost:9090 | Métriques et alertes (`/alerts`) |
| Grafana | http://localhost:3001 | Tableau de bord (admin / admin) |

Vérification automatique :
```bash
bash scripts/smoke_test.sh
```

## 4. Entraîner et déployer un modèle (orchestrateur)
1. Ouvrir Prefect (http://localhost:4200), aller dans **Deployments**, choisir `training-pipeline`, puis **Run**.
2. Le flow enchaîne : `dvc pull`, validation des données, `prepare`, `train`, `evaluate`, **quality gate**, `export` (ONNX + MLflow Registry), `reference`, `dvc push`, rechargement de l'API (`/admin/reload`).
3. Suivre l'exécution dans **Runs** (graphe des tâches, logs, retries).
4. Résultat : run et version de modèle dans MLflow, nouvelles métriques sur la page « Modèle IA & MLOps », `models/metadata.json` servi par l'API.

Pour une démo sur CPU, réduire le jeu de données dans `params.yaml` (`data.quick_n: 50`) avant de lancer le flow.

## 5. Environnements staging et production (images du registry)
La CD (`.github/workflows/cd.yml`) construit les images une seule fois par commit validé par la CI. Elle les pousse sur GHCR avec un tag immuable (le SHA), puis :

| Étape | Ce qui se passe |
|---|---|
| `release` | `ghcr.io/<owner>/phytora-{backend,gateway,frontend}:<sha>` et `:staging` |
| `deploy-staging` | déploiement des images, `dvc pull` du modèle (si le secret `DAGSHUB_TOKEN` existe), test de fumée |
| `promote-production` | retag des **mêmes** images en `:prod` et `:latest`, test de fumée, **rollback** automatique vers les anciennes images `:prod` en cas d'échec |

Pour ajouter une validation manuelle avant la production : *Settings > Environments > production > Required reviewers*.

Déployer une version publiée sur une machine (Git Bash sous Windows) :
```bash
bash scripts/deploy.sh staging <sha>     # test de fumée, rollback automatique si échec
bash scripts/deploy.sh prod <sha>
bash scripts/rollback.sh prod            # revenir à la version précédente
```
L'historique des déploiements est écrit dans `deploy/history.log`.

## 6. Continuous Training
- **Prefect** : le flow `monitoring-check` (toutes les 6 h) déclenche `training-pipeline` s'il détecte une dérive. Le flow `ingest-new-data` (toutes les 30 min) versionne les images déposées dans `data/incoming/<classe>/`, puis déclenche le réentraînement.
- **GitHub Actions** (`ct.yml`) se déclenche dans quatre cas : un nouveau `.dvc` sous `data/`, un `repository_dispatch` de type `retrain`, chaque lundi, ou à la main. Il exécute `dvc exp run`, `dvc push` et ouvre une PR avec le nouveau `dvc.lock`. Secrets à créer dans *Settings > Secrets > Actions* : `DAGSHUB_TOKEN`, et optionnellement `MLFLOW_TRACKING_URI` et `MLFLOW_TRACKING_USERNAME` (MLflow DagsHub).

## 7. Arrêter, nettoyer
```bash
docker compose down          # garde les volumes (MongoDB, MLflow, Prefect, Grafana, logs)
docker compose down -v       # supprime aussi les volumes
```
