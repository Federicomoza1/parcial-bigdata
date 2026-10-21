# Airline Reservation System & Managerial Analytics Panel (Parcial 2)

End-to-end repository containing the Transactional Backend (`FastAPI`), Customer & Manager Frontend (`HTML/JS`), Batch ETL Job (`PySpark` on `AWS EMR`), Analytical Catalog (`AWS Glue` + `Amazon Athena`), Cost Projection (`cost_projection.yaml`), and the Automated Grading Harness (`pytest`).

---

## Repository Structure

```text
airline-reservation-analytics/
├── airline_data/               # Synthetic dataset generator & ground-truth oracle (DO NOT MODIFY)
├── backend/
│   └── app.py                  # FastAPI backend (R1, R2, R3, R7)
├── frontend/
│   ├── index.html              # Customer booking portal `/` (R8 selectors)
│   ├── manager.html            # Managerial occupancy panel `/manager` (R9 selectors)
│   └── server.py               # Lightweight HTTP server on port 3000
├── emr/
│   └── etl_job.py              # PySpark job implementing cleaning rules C1–C5 (R4, R5, R6)
├── scripts/
│   ├── run_emr_pipeline.py     # Generates raw CSVs, uploads to S3, runs transient m4.large EMR step, registers Glue
│   ├── setup_glue_athena.py    # Creates Glue Catalog tables & runs MSCK REPAIR TABLE (24 partitions)
│   ├── sync_cost_projection.py # Syncs cost_projection.yaml with live AWS resources (R12)
│   ├── start_services.sh       # Starts Backend (:8000) and Frontend (:3000) on EC2
│   └── stop_services.sh        # Stops Backend and Frontend processes
├── contract/                   # API, Data, Frontend, and Cost Projection contracts (DO NOT MODIFY)
├── harness/                    # Harness AWS & cost adapters (DO NOT MODIFY)
├── tests/                      # Automated verification suite R1–R12 (DO NOT MODIFY)
├── config.example.yaml         # Template configuration file
├── cost_projection.yaml        # Monthly cost projection (R12)
├── pricing.yaml                # Reference pricing (DO NOT MODIFY)
├── thresholds.yaml             # Harness thresholds (DO NOT MODIFY)
├── pytest.ini                  # Pytest configuration
└── requirements.txt            # Python dependencies
```

---

## Step-by-Step Execution Guide on EC2 (AWS Academy Learner Lab)

### 1. Launch EC2 Instance & Security Group
1. Launch an Ubuntu or Amazon Linux EC2 instance of type **`t3.small`** (or `t3.micro` / `t3.medium` — allowed by **R11**).
2. Attach the **`LabInstanceProfile`** IAM role so the EC2 instance can call S3, Athena, Glue, EMR, EC2, and RDS APIs, or configure `~/.aws/credentials` from the Learner Lab *AWS Details* panel.
3. In the EC2 **Security Group**, allow Inbound TCP ports:
   - `22` (SSH)
   - `8000` (Backend API)
   - `3000` (Frontend Web UI)

### 2. Clone Repository & Install Dependencies on EC2
```bash
# Install Python3, pip, and Playwright system dependencies
sudo apt-get update && sudo apt-get install -y python3-pip python3-venv || sudo yum install -y python3-pip

python3 -m venv .venv
source .venv/bin/activate

pip install --upgrade pip
pip install -r requirements.txt
playwright install --with-deps chromium
```

### 3. Configure `config.yaml`
Copy `config.example.yaml` to `config.yaml` and fill in your team's assigned `seed`, your EC2 public IP (or `127.0.0.1` if testing locally on the same EC2), and your S3 bucket name:
```bash
cp config.example.yaml config.yaml
nano config.yaml
```
Example `config.yaml`:
```yaml
team_id: "team01"
seed: 12345              # Replace with your team's assigned seed

backend:
  base_url: "http://YOUR-EC2-PUBLIC-IP:8000"
frontend:
  base_url: "http://YOUR-EC2-PUBLIC-IP:3000"

aws:
  region: us-east-1
  athena_workgroup: primary
  athena_database: airline_analytics
  athena_output: "s3://YOUR-UNIQUE-BUCKET-NAME/athena-results/"
  tables:
    detail: reservations_curated
    metrics: route_month_metrics

cost_projection_file: cost_projection.yaml
```

### 4. Run the EMR Batch Pipeline & Register Glue/Athena Tables (R4, R5, R6, R10)
Run the automated pipeline script. It will:
1. Create your S3 bucket if it doesn't exist.
2. Generate `raw/flights.csv` and `raw/reservations.csv` using your `seed` (2,000,000 rows).
3. Upload the raw CSVs and `emr/etl_job.py` to S3.
4. Launch a transient **AWS EMR cluster** (`1 x m4.large` Master + `2 x m4.large` Core) with `KeepJobFlowAliveWhenNoSteps=False` so it **automatically terminates** as soon as the PySpark step finishes (**R10**, **R11**).
5. Create the Glue Data Catalog database `airline_analytics`, tables `reservations_curated` (partitioned by `month`) and `route_month_metrics`, and register all 24 partitions (**R5**, **R6**).

```bash
python3 scripts/run_emr_pipeline.py --bucket YOUR-UNIQUE-BUCKET-NAME
```

### 5. Start Backend & Frontend Services (R1, R2, R3, R7, R8, R9)
```bash
chmod +x scripts/start_services.sh scripts/stop_services.sh
./scripts/start_services.sh
```
*(Optional: If using an RDS PostgreSQL instance instead of local transactional SQLite, export `DATABASE_URL="postgresql://user:pass@rds-endpoint:5432/dbname"` before running `./scripts/start_services.sh`.)*

### 6. Sync Cost Projection with Live AWS Resources (R12)
Before running the test suite, synchronize `cost_projection.yaml` with the exact active resources and EMR normalized hours recorded in your AWS account:
```bash
python3 scripts/sync_cost_projection.py
```

### 7. Run the Automated Grading Harness (`pytest`)
```bash
pytest
```
This runs all checks for **R1–R12** and writes `report.json` and `report.md` in the root folder.
