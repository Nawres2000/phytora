"""Registers the PHYTORA flows as Prefect deployments with their schedules and executes their runs.

    python -m src.pipelines.serve          # needs PREFECT_API_URL (docker compose sets it)

Schedules (UTC): training every Monday 03:00, drift check every 6 hours, ingestion every 30 minutes.
On demand only: experiment-grid (baseline / MobileNet / ablation / EfficientNet) and cross-validation.
Each flow can also be started by hand from the Prefect UI ("Run" button) or by `prefect deployment run`.
"""

from prefect import serve

from src.pipelines.experiments import cross_validation, experiment_grid
from src.pipelines.flows import ingest_new_data, monitoring_check, training_pipeline


def main():
    serve(
        training_pipeline.to_deployment(
            name="training-pipeline",
            cron="0 3 * * 1",
            parameters={"reason": "schedule"},
            tags=["training", "ct"],
            description="Réentraînement hebdomadaire et à la demande",
        ),
        monitoring_check.to_deployment(
            name="monitoring-check",
            cron="0 */6 * * *",
            tags=["monitoring", "drift"],
            description="Détection de dérive Evidently, déclenche le réentraînement",
        ),
        ingest_new_data.to_deployment(
            name="ingest-new-data", interval=1800, tags=["data"], description="Ingestion des nouvelles images de data/incoming"
        ),
        experiment_grid.to_deployment(
            name="experiment-grid",
            parameters={"quick_n": 50},
            tags=["experiments", "mlflow"],
            description="Grille d'expériences : baseline, MobileNet, ablation Focal/CutMix/RandAugment, EfficientNet",
        ),
        cross_validation.to_deployment(
            name="cross-validation",
            parameters={"folds": 3, "quick_n": 50},
            tags=["experiments"],
            description="Validation croisée k-fold stratifiée et groupée (moyenne ± écart-type du F1 macro)",
        ),
    )


if __name__ == "__main__":
    main()
