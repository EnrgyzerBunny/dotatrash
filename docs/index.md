## Dota Trash League

<table>
<tr>
<th>ID</th><th>Player</th><th>Role</th>
</tr>
{% for member in site.data.players %}
    {% if member.FantasyTeamID == "0" %}
      <tr><td>{{ member.PlayerID }}</td><td>{{ member.PlayerName }}</td><td>{{ member.FantasyRole }}</td></tr>
    {% endif %}
{% endfor %}
</table>
