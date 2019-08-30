const mysql      = require('mysql');
const {promisify} = require('util');

const connection = mysql.createConnection({
    host     : 'localhost',
    user     : process.env.DB_USERNAME,
    password : process.env.DB_PASSWORD,
    database : 'downvote_control_tool',
    charset: 'utf8mb4'
});

connection.connect();
const db = promisify(connection.query).bind(connection);

module.exports = {
    db,
};