package forge.harness.host;

import forge.LobbyPlayer;
import forge.game.Game;
import forge.game.player.IGameEntitiesFactory;
import forge.game.player.Player;
import forge.game.player.PlayerController;

public final class ForgeHumanLobbyPlayer extends LobbyPlayer implements IGameEntitiesFactory {
    private final ManaBrewInteractiveSession session;

    public ForgeHumanLobbyPlayer(final String name, final ManaBrewInteractiveSession session) {
        super(name);
        this.session = session;
    }

    @Override
    public Player createIngamePlayer(final Game game, final int id) {
        final Player player = new Player(getName(), game, id);
        player.setFirstController(new ForgeHumanController(game, player, this, session));
        return player;
    }

    @Override
    public PlayerController createMindSlaveController(final Player master, final Player slave) {
        return new ForgeHumanController(slave.getGame(), slave, this, session);
    }

    @Override
    public void hear(final LobbyPlayer player, final String message) {
    }
}
