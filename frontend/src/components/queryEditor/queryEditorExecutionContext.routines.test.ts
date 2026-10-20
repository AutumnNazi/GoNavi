import { describe, expect, it } from 'vitest';
import { resolveQueryEditorExecutionContext as resolve } from './queryEditorExecutionContext';

const selectedDb = 'app_db';
const inspectProcedure = `CREATE PROCEDURE inspect_tables()
SQL SECURITY INVOKER
BEGIN
    DECLARE schema_name VARCHAR(64) DEFAULT DATABASE();
    DECLARE table_cursor CURSOR FOR
        SELECT table_name FROM information_schema.tables WHERE table_schema = schema_name;
    IF EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = schema_name) THEN
        SELECT * FROM archive_db.messages;
    END IF;
END`;

describe('routine definitions preserve the selected execution context', () => {
    it.each(['mysql', 'mariadb', 'oceanbase', 'tidb', 'goldendb'])(
        '%s does not use a cursor or nested query source as the creation database',
        (dialect) => {
            expect(resolve(inspectProcedure, dialect, selectedDb)).toEqual({});
        },
    );

    it.each([
        inspectProcedure.replace(/information_schema/g, 'catalog_db'),
        inspectProcedure.replace('inspect_tables()', '`app_db`.`inspect_tables`()'),
        inspectProcedure.replace('inspect_tables()', '`target_db`.`inspect_tables`()'),
        inspectProcedure.replace('CREATE PROCEDURE', "CREATE DEFINER = 'routine_user'@'%' PROCEDURE"),
        inspectProcedure.replace('CREATE PROCEDURE', 'CREATE DEFINER = CURRENT_USER() PROCEDURE'),
        inspectProcedure.replace('CREATE PROCEDURE', 'CREATE DEFINER = `routine_user`@`localhost` PROCEDURE'),
        inspectProcedure.replace('CREATE PROCEDURE', 'cReAtE /* header */ pRoCeDuRe'),
        '-- USE wrong_db; SELECT * FROM wrong_db.t\n' + inspectProcedure,
        '/* SELECT * FROM wrong_db.t; */\n' + inspectProcedure,
        '# SELECT * FROM wrong_db.t\n' + inspectProcedure,
        'CREATE PROCEDURE inspect_tables() SELECT * FROM archive_db.messages',
        "CREATE FUNCTION item_count() RETURNS INT READS SQL DATA RETURN (SELECT COUNT(*) FROM archive_db.items)",
        "CREATE DEFINER='routine_user'@'%' FUNCTION `target_db`.`item_count`() RETURNS INT BEGIN RETURN (SELECT COUNT(*) FROM archive_db.items); END",
        "CREATE PROCEDURE `SELECT FROM archive_db.messages`() BEGIN SELECT 'USE wrong_db; FROM wrong_db.t'; SELECT * FROM catalog_db.tables; END",
        'DELIMITER $$\n' + inspectProcedure + '$$\nDELIMITER ;',
        'DELIMITER //\n' + inspectProcedure + '//\nDELIMITER ;',
        '/*!50003 CREATE PROCEDURE inspect_tables() */ SELECT * FROM catalog_db.tables',
        '/*+ SQL_NO_CACHE */ /*!50003 CREATE PROCEDURE inspect_tables() */ SELECT * FROM catalog_db.tables',
    ])('does not infer a session switch from definition SQL: %s', (sql) => {
        expect(resolve(sql, 'mysql', selectedDb)).toEqual({});
    });

    it.each([
        ['mariadb', inspectProcedure.replace('CREATE PROCEDURE', "CREATE OR REPLACE DEFINER = 'owner'@'%' PROCEDURE")],
        ['mariadb', inspectProcedure.replace('CREATE PROCEDURE', 'CREATE PROCEDURE IF NOT EXISTS')],
        ['mariadb', '/*+ hint */ /*M!100100 CREATE PROCEDURE inspect_tables() */ SELECT * FROM catalog_db.tables'],
        ['postgres', 'CREATE FUNCTION inspect_tables() RETURNS BIGINT LANGUAGE SQL BEGIN ATOMIC SELECT COUNT(*) FROM catalog.tables; END'],
        ['postgres', 'CREATE OR REPLACE FUNCTION inspect_tables() RETURNS BIGINT AS $body$ SELECT COUNT(*) FROM catalog.tables; $body$ LANGUAGE SQL'],
        ['sqlserver', 'CREATE OR ALTER PROCEDURE dbo.inspect_tables AS BEGIN SELECT * FROM catalog_db.dbo.tables; END'],
        ['oracle', 'CREATE OR REPLACE PROCEDURE inspect_tables AS BEGIN SELECT table_name FROM catalog.tables; END;\n/'],
    ])('preserves %s routine context', (dialect, sql) => {
        expect(resolve(sql, dialect, selectedDb, 'public')).toEqual({});
    });

    it.each([
        'CREATE VIEW table_list AS SELECT * FROM catalog_db.tables',
        'CREATE TABLE table_list AS SELECT * FROM catalog_db.tables',
        'CREATE TRIGGER copy_row AFTER INSERT ON items FOR EACH ROW INSERT INTO archive_db.items VALUES (NEW.id)',
        'CREATE EVENT copy_items ON SCHEDULE EVERY 1 DAY DO INSERT INTO archive_db.items SELECT * FROM items',
        'ALTER VIEW table_list AS SELECT * FROM catalog_db.tables',
    ])('does not confuse other definition sources with their targets: %s', (sql) => {
        expect(resolve(sql, 'mysql', selectedDb)).toEqual({});
    });
});

describe('explicit USE and batch execution context', () => {
    it.each([
        ['mysql', 'USE target_db; ' + inspectProcedure, { dbName: 'target_db' }],
        ['mysql', 'USE app_db; ' + inspectProcedure, {}],
        ['mysql', 'USE target_db; SELECT * FROM archive_db.items', { dbName: 'target_db' }],
        ['mysql', 'USE app_db; SELECT * FROM archive_db.items', {}],
        ['mysql', 'USE target_db; USE later_db; SELECT * FROM archive_db.items', { dbName: 'target_db' }],
        ['mysql', '; /* header */ USE `target_db`; ' + inspectProcedure, { dbName: 'target_db' }],
        ['mysql', 'USE `target``db`; SELECT * FROM archive_db.items', { dbName: 'target`db' }],
        ['mysql', 'DELIMITER //\nUSE target_db//\n' + inspectProcedure + '//\nDELIMITER ;', { dbName: 'target_db' }],
        ['sqlserver', 'USE [target_db]\nGO\nSELECT * FROM archive_db.dbo.items', { dbName: 'target_db' }],
        ['sqlserver', 'USE [target]]db]; SELECT * FROM archive_db.dbo.items', { dbName: 'target]db' }],
        ['clickhouse', 'USE target_db; SELECT * FROM archive_db.items', { dbName: 'target_db' }],
        ['tdengine', 'USE target_db; SELECT * FROM archive_db.items', { dbName: 'target_db' }],
    ])('%s honors only the leading USE: %s', (dialect, sql, expected) => {
        expect(resolve(sql, dialect, selectedDb)).toEqual(expected);
    });

    it('canonicalizes an explicit USE without allowing a later reference to replace it', () => {
        expect(resolve('USE target_db; SELECT * FROM archive_db.items', 'mysql', selectedDb, '', ['Target_DB']))
            .toEqual({ dbName: 'Target_DB' });
    });

    it.each([
        inspectProcedure + '; SELECT * FROM archive_db.items;',
        'SELECT * FROM archive_db.items; ' + inspectProcedure,
        'DROP PROCEDURE IF EXISTS inspect_tables; ' + inspectProcedure,
        'SELECT * FROM local_items; SELECT * FROM archive_db.items;',
        'SELECT * FROM archive_db.items; SELECT * FROM local_items;',
        'SET @schema_name = DATABASE(); USE target_db; ' + inspectProcedure,
        'DELIMITER $$\n' + inspectProcedure + '$$\nDELIMITER ;\nCALL inspect_tables();',
    ])('does not retarget the whole batch from one of its table references: %s', (sql) => {
        expect(resolve(sql, 'mysql', selectedDb)).toEqual({});
    });
});

describe('single ordinary statements retain context inference', () => {
    it.each([
        'SELECT * FROM archive_db.items',
        '; SELECT * FROM archive_db.items; ; -- trailing comment',
        "SELECT 'CREATE PROCEDURE p() SELECT * FROM fake_db.items; USE fake_db' FROM archive_db.items",
        'SELECT "CREATE FUNCTION f() RETURNS INT RETURN 1;" FROM archive_db.items',
        '/* CREATE PROCEDURE p() BEGIN */ SELECT * FROM archive_db.items /* END */',
        '/*+ hint */ /* normal comment */ /*+ hint */ SELECT * FROM archive_db.items',
        'WITH items AS (SELECT * FROM archive_db.items) SELECT * FROM items',
        'INSERT INTO archive_db.items SELECT * FROM local_items',
        'UPDATE archive_db.items SET value = 1',
        'DELETE FROM archive_db.items WHERE id = 1',
        'REPLACE INTO archive_db.items VALUES (1)',
        'DELIMITER //\nSELECT * FROM archive_db.items//\nDELIMITER ;',
    ])('still resolves the qualified table in %s', (sql) => {
        expect(resolve(sql, 'mysql', selectedDb)).toEqual({ dbName: 'archive_db' });
    });

    it('still supports direct system catalog queries', () => {
        expect(resolve('SELECT * FROM information_schema.tables', 'mysql', selectedDb))
            .toEqual({ dbName: 'information_schema' });
    });
});
