const Discord = require('discord.js');
const fs = require("fs"); 

const client = new Discord.Client();
const token = require("./token.json")
const guild_id = require("./guild.json")

process.on("unhandledRejection", error => console.error("Promise rejection:", error));

client.on('ready', () => {
    client.api.applications(client.user.id).guilds(guild_id.id).commands.post({
        data: {
            name: "test-command",
            description: "testing slash cmds"
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

        if (command === 'test-command'){ 
            
            client.api.interactions(interaction.id, interaction.token).callback.post({
                data: {
                    type: 4,
                    data: {
                        content: "I am a trash bot"
                    }
                }
            })
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

