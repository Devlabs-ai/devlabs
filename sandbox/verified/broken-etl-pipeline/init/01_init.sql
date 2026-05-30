-- Create Airflow metadata database role and database
CREATE ROLE airflow WITH LOGIN PASSWORD 'airflow';
CREATE DATABASE airflow OWNER airflow;
GRANT ALL PRIVILEGES ON DATABASE airflow TO airflow;

-- Create ETL application database role and database
CREATE ROLE etl_user WITH LOGIN PASSWORD 'etl_pass';
CREATE DATABASE etl_db OWNER etl_user;
GRANT ALL PRIVILEGES ON DATABASE etl_db TO etl_user;
