const Discord = require('discord.js');
const fs = require("fs");
const mysql = require('mysql');

const client = new Discord.Client();
const token = require("./token.json")
const guild_id = require("./guild.json")

//DB refrence
const TrashDB = mysql.createConnection({
    host: "localhost",
    user: "trashbot",
    password: "password",
    database: "EnrgyzerBunny_Collider"
});

TrashDB.connect();
console.log("TrashDB Connected.");



process.on("unhandledRejection", error => console.error("Promise rejection:", error));

client.on('ready', () => {

    console.log("Client Initiated.");

    client.api.applications(client.user.id).guilds(guild_id.id).commands.post({
        data: {
            name: "teams",
            description: "list season teams"
            // possible options here e.g. options: [{...}]
        }
    });

    client.api.applications(client.user.id).commands.post({
        data: {
            name: "test-global",
            description: "testing slash cmds"
            // possible options here e.g. options: [{...}]
        }
    });


    client.ws.on('INTERACTION_CREATE', async interaction => {
        const command = interaction.data.name.toLowerCase();
        const args = interaction.data.options;

        if (command === 'teams'){ 
            PullTeams(interaction.id, interaction.token);
            // client.api.interactions(interaction.id, interaction.token).callback.post({
            //     data: {
            //         type: 4,
            //         data: {
            //             content: PullTeams()
            //         }
            //     }
            // })
        }

        if (command === 'test-global'){ 
            
            client.api.interactions(interaction.id, interaction.token).callback.post({
                data: {
                    type: 4,
                    data: {
                        content: "Global version: I'm still trash"
                    }
                }
            })
        }
    });
});

client.login(token.token);

function PullTeams(interactionid, interactiontoken)
{
    
    
    TrashDB.query("SELECT * FROM Team", function (err, result, fields) {
        if (err) throw err;
        console.log(JSON.stringify(result));

        let ouput = "```\n";

        for (var i = 0; i < result.length;i++)
        {
            ouput += result[i].TeamName + " | Season " + (Number(result[i].SeasonID) + 1) + "\n";
        }

        ouput += "```";


        client.api.interactions(interactionid, interactiontoken).callback.post({
            data: {
                type: 4,
                data: {
                    content: ouput
                }
            }
        });
        //TrashDB.end();

    });
    //console.log("Connected to TrashDB.");
    


}

