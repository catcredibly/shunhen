//! A pinned SQLite connection. Frontend Web Locks serialize windows; tokens keep
//! unrelated requests out of a transaction even if a caller bypasses the lock.
use rusqlite::{
    params_from_iter,
    types::{Value as SqlValue, ValueRef},
    Connection,
};
use serde_json::{json, Map, Value};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

pub struct Storage(pub Mutex<Store>);
pub struct Store {
    connection: Connection,
    owner: Option<(String, String)>,
    dirty: bool,
}

pub fn install(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let directory = app.path().app_data_dir()?;
    std::fs::create_dir_all(&directory)?;
    let connection = Connection::open(directory.join("shunhen.sqlite3"))?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    connection.execute_batch(
        "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
    )?;
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version > 1 {
        return Err("Unsupported SQLite schema version".into());
    }
    if version == 0 {
        connection.execute_batch("BEGIN IMMEDIATE")?;
        if let Err(error) = connection.execute_batch(include_str!("../../src/storage/schema.sql")) {
            let _ = connection.execute_batch("ROLLBACK");
            return Err(error.into());
        }
        connection.execute_batch("COMMIT")?;
    }
    app.manage(Storage(Mutex::new(Store {
        connection,
        owner: None,
        dirty: false,
    })));
    Ok(())
}

pub fn release_window(app: &tauri::AppHandle, label: &str) {
    let storage = app.state::<Storage>();
    if let Ok(mut store) = storage.0.lock() {
        if store
            .owner
            .as_ref()
            .is_some_and(|(_, owner)| owner == label)
        {
            let _ = store.connection.execute_batch("ROLLBACK");
            store.owner = None;
        }
    };
}

#[tauri::command]
pub fn storage_request(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    storage: tauri::State<'_, Storage>,
    action: String,
    token: Option<String>,
    sql: Option<String>,
    parameters: Option<Vec<Value>>,
) -> Result<Value, String> {
    let mut store = storage.0.lock().map_err(|e| e.to_string())?;
    let result = (|| -> Result<Value, Box<dyn std::error::Error>> {
        if action == "begin" {
            if store.owner.is_some() {
                return Err("SQLite transaction already active".into());
            }
            let token = token.ok_or("Missing transaction token")?;
            store.connection.execute_batch("BEGIN IMMEDIATE")?;
            store.owner = Some((token, window.label().to_owned()));
            store.dirty = false;
            return Ok(Value::Null);
        }
        if store
            .owner
            .as_ref()
            .map(|(key, owner)| (key.as_str(), owner.as_str()))
            != token.as_deref().map(|key| (key, window.label()))
        {
            return Err("SQLite transaction owner mismatch".into());
        }
        if action == "commit" || action == "rollback" {
            store.connection.execute_batch(if action == "commit" {
                "COMMIT"
            } else {
                "ROLLBACK"
            })?;
            store.owner = None;
            if action == "commit" && store.dirty {
                let _ = app.emit("storage-changed", ());
            }
            return Ok(Value::Null);
        }
        let values = parameters
            .unwrap_or_default()
            .into_iter()
            .map(|value| -> Result<SqlValue, String> {
                Ok(match value {
                    Value::Null => SqlValue::Null,
                    Value::Bool(value) => SqlValue::Integer(i64::from(value)),
                    Value::Number(value) => {
                        if let Some(value) = value.as_i64() {
                            SqlValue::Integer(value)
                        } else {
                            SqlValue::Real(value.as_f64().ok_or("Invalid SQL number")?)
                        }
                    }
                    Value::String(value) => SqlValue::Text(value),
                    _ => return Err("SQL parameters must be scalar".into()),
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let sql = sql.ok_or("Missing SQL")?;
        if action == "select" {
            let mut statement = store.connection.prepare(&sql)?;
            if !statement.readonly() {
                return Err("Select must be read-only".into());
            }
            let names = statement
                .column_names()
                .into_iter()
                .map(str::to_owned)
                .collect::<Vec<_>>();
            let rows = statement
                .query_map(params_from_iter(values.iter()), |row| {
                    let mut object = Map::new();
                    for (index, name) in names.iter().enumerate() {
                        let value = match row.get_ref(index)? {
                            ValueRef::Null => Value::Null,
                            ValueRef::Integer(value) => json!(value),
                            ValueRef::Real(value) => json!(value),
                            ValueRef::Text(value) => json!(String::from_utf8_lossy(value)),
                            ValueRef::Blob(_) => Value::Null,
                        };
                        object.insert(name.clone(), value);
                    }
                    Ok(Value::Object(object))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(Value::Array(rows))
        } else if action == "execute" {
            // Transaction control is exclusively through begin/commit/rollback.
            let command = sql
                .trim_start()
                .split_whitespace()
                .next()
                .unwrap_or("")
                .to_uppercase();
            if !matches!(command.as_str(), "INSERT" | "UPDATE" | "DELETE") {
                return Err("Unsupported storage write".into());
            }
            let affected = store
                .connection
                .execute(&sql, params_from_iter(values.iter()))?;
            let id = store.connection.last_insert_rowid();
            store.dirty |= affected > 0;
            if store.owner.is_none() && affected > 0 {
                let _ = app.emit("storage-changed", ());
            }
            Ok(json!({ "id": id, "affected": affected }))
        } else {
            Err("Unknown storage action".into())
        }
    })();
    result.map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn schema_enforces_relations_pauses_and_rollback() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(include_str!("../../src/storage/schema.sql"))
            .unwrap();
        db.execute_batch("INSERT INTO academic_years(id,name) VALUES(1,'Year'); INSERT INTO subjects(id,academic_year_id,name,color_id) VALUES(1,1,'Subject',0); INSERT INTO sessions(id,subject_id,started_at,elapsed_seconds) VALUES(1,1,100,60);").unwrap();
        db.execute("INSERT INTO session_pauses VALUES(1,10,5)", [])
            .unwrap();
        assert!(db
            .execute("INSERT INTO session_pauses VALUES(1,12,5)", [])
            .is_err());
        assert!(db
            .execute("INSERT INTO session_pauses VALUES(1,59,2)", [])
            .is_err());
        assert!(db
            .execute(
                "INSERT INTO sessions(subject_id,started_at,elapsed_seconds) VALUES(99,100,60)",
                []
            )
            .is_err());
        db.execute_batch("BEGIN; DELETE FROM academic_years; ROLLBACK;")
            .unwrap();
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM session_pauses", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        db.execute("DELETE FROM academic_years", []).unwrap();
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM session_pauses", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}
