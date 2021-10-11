## Dota Trash League

| ID | Player | Role |
| --- | --- | --- |
{% for member in site.data.players -%}
{% if member.FantasyTeamID == "0" -%}
| {{ member.PlayerID }} | {{ member.PlayerName }} | {{ member.FantasyRole }} |
{% endif %}
{%- endfor -%}
