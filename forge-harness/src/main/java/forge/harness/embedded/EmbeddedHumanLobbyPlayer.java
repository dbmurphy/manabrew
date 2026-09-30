package forge.harness.embedded;

import forge.LobbyPlayer;
import forge.game.Game;
import forge.game.player.IGameEntitiesFactory;
import forge.game.player.Player;
import forge.game.player.PlayerController;

public final class EmbeddedHumanLobbyPlayer extends LobbyPlayer implements IGameEntitiesFactory {

    @FunctionalInterface
    public interface SeatFactory {
        HumanSeat create(Game game, Player player, LobbyPlayer lobbyPlayer);
    }

    private final SeatFactory seats;

    public EmbeddedHumanLobbyPlayer(final String name, final SeatFactory seats) {
        super(name);
        this.seats = seats;
    }

    @Override
    public Player createIngamePlayer(final Game game, final int id) {
        final Player player = new Player(getName(), game, id);
        player.setFirstController(new EmbeddedHumanController(game, player, this, seats.create(game, player, this)));
        return player;
    }

    @Override
    public PlayerController createMindSlaveController(final Player master, final Player slave) {
        return new EmbeddedHumanController(slave.getGame(), slave, this, seats.create(slave.getGame(), slave, this));
    }

    @Override
    public void hear(final LobbyPlayer player, final String message) {
    }
}
