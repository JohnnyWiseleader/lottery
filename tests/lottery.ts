import assert from "assert";
import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import { Lottery } from "../target/types/lottery";

describe("lottery", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(anchor.AnchorProvider.local());

  const LAMPORTS_PER_SOL = 1000000000;

  // Account address generated here
  const lottery = anchor.web3.Keypair.generate();
  const lotteryAdmin = anchor.web3.Keypair.generate();
  const player1 = anchor.web3.Keypair.generate();
  const player2 = anchor.web3.Keypair.generate();
  const skintPlayer3 = anchor.web3.Keypair.generate();
  const oracle = anchor.web3.Keypair.generate();

  // Get program IDL for rock-paper-scissor
  const program = anchor.workspace.lottery as Program<Lottery>;

  before(async () => {
    // Top up all acounts that will need lamports for account creation
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        player1.publicKey,
        2 * LAMPORTS_PER_SOL
      )
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        player2.publicKey,
        2 * LAMPORTS_PER_SOL
      )
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        lotteryAdmin.publicKey,
        2 * LAMPORTS_PER_SOL
      )
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        skintPlayer3.publicKey,
        0.4 * LAMPORTS_PER_SOL
      )
    );
  });

  it("Creates a lottery account", async () => {
    try {
      await program.methods
        .initialiseLottery(new anchor.BN(LAMPORTS_PER_SOL), oracle.publicKey)
        .accounts({
          lottery: lottery.publicKey,
          admin: lotteryAdmin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([lottery, lotteryAdmin])
        .rpc();

      console.log("Lottery account initialized at:", lottery.publicKey.toString());

      let lotteryState = await program.account.lottery.fetch(lottery.publicKey);
      console.log("Lottery state after initialization:", lotteryState);

      // Assert lottery intiliased to zero
      expect(lotteryState.count).to.equal(0);

      // Assert authority matches lottery admin
      expect(lotteryState.admin.toString()).to.equal(
        lotteryAdmin.publicKey.toString()
      );

      // Assert ticket price has been set
      expect(lotteryState.ticketPrice.toNumber()).to.equal(LAMPORTS_PER_SOL);

    } catch (err) {
      console.error("Failed to initialize lottery:", err);
      assert(false);
    }
  });

  it("Submits a bid as player1", async () => {
    // Get starting balances for player1 and lottery account
    let startBalancePlayer: number = await provider.connection.getBalance(
      player1.publicKey
    );
    let startBalanceLottery: number = await provider.connection.getBalance(
      lottery.publicKey
    );

    // Get lottery index
    let idx: number = (await program.account.lottery.fetch(lottery.publicKey))
      .count;

    // Consutruct buffer containing latest index
    const buf1 = Buffer.alloc(4);
    buf1.writeUIntBE(idx, 0, 4);

    const [submission2, bump] = await anchor.web3.PublicKey.findProgramAddress(
      [buf1, lottery.publicKey.toBytes()],
      program.programId
    );

    // Get lottery ticket
    await program.methods
      .buyTicket()
      .accounts({
        lottery: lottery.publicKey,
        player: player1.publicKey,
        ticket: submission2,
        systemProgram: SystemProgram.programId,
      })
      .signers([player1])
      .rpc();

    // Get ending balances for player and lottery
    let endBalanacePlayer: number = await provider.connection.getBalance(
      player1.publicKey
    );
    let endBalanceLottery: number = await provider.connection.getBalance(
      lottery.publicKey
    );

    // Assert lottery lamport balance is higher
    expect(endBalanceLottery).to.be.greaterThan(startBalanceLottery);

    // Assert player lamport balance is lower
    expect(startBalancePlayer).to.be.greaterThan(endBalanacePlayer);

    // Assert lottery incremented to 1
    let lotteryState = await program.account.lottery.fetch(lottery.publicKey);
    expect(lotteryState.count).to.equal(idx + 1);

    // Assert submitters key matches the one provided
    let submissionState = await program.account.ticket.fetch(submission2);
    expect(submissionState.submitter.toString()).to.equal(
      player1.publicKey.toString()
    );
  });

  it("Submits a bid as player2", async () => {
    // Get starting balances for player and lottery account
    let startBalancePlayer: number = await provider.connection.getBalance(
      player2.publicKey
    );
    let startBalanceLottery: number = await provider.connection.getBalance(
      lottery.publicKey
    );

    // Get lottery index
    let idx: number = (await program.account.lottery.fetch(lottery.publicKey))
      .count;
    // Consutruct buffer containing latest index
    const buf1 = Buffer.alloc(4);
    buf1.writeUIntBE(idx, 0, 4);

    const [ticket, bump] = await anchor.web3.PublicKey.findProgramAddress(
      [buf1, lottery.publicKey.toBytes()],
      program.programId
    );

    // Get lottery ticket
    await program.methods
      .buyTicket()
      .accounts({
        lottery: lottery.publicKey,
        player: player2.publicKey,
        ticket: ticket,
        systemProgram: SystemProgram.programId,
      })
      .signers([player2])
      .rpc();

    // Get ending balances for player and lottery
    let endBalanacePlayer = await provider.connection.getBalance(
      player2.publicKey
    );
    let endBalanceLottery: number = await provider.connection.getBalance(
      lottery.publicKey
    );

    // Assert player lamport balance is lower
    expect(startBalancePlayer).to.be.greaterThan(endBalanacePlayer);

    // Assert lottery lamport balance is higher
    expect(endBalanceLottery).to.be.greaterThan(startBalanceLottery);

    // Assert lottery counter incremented by 1
    let lotteryState: number = (
      await program.account.lottery.fetch(lottery.publicKey)
    ).count;
    expect(lotteryState).to.equal(idx + 1);

    // Assert submitters key matches the one provided
    let submissionState = await program.account.ticket.fetch(ticket);
    expect(submissionState.submitter.toString()).to.equal(
      player2.publicKey.toString()
    );
  });

  it("Can't submit as player3 with no money", async () => {
    try {
      // Get lottery index
      let idx: number = (await program.account.lottery.fetch(lottery.publicKey))
        .count;
      // Consutruct buffer containing latest index
      const buf1 = Buffer.alloc(4);
      buf1.writeUIntBE(idx, 0, 4);

      const [ticket, bump] = await anchor.web3.PublicKey.findProgramAddress(
        [buf1, lottery.publicKey.toBytes()],
        program.programId
      );

      // Get lottery ticket
      await program.methods
        .buyTicket()
        .accounts({
          lottery: lottery.publicKey,
          player: skintPlayer3.publicKey,
          ticket: ticket,
          systemProgram: SystemProgram.programId,
        })
        .signers([skintPlayer3])
        .rpc();
      assert(false);
    } catch (err) {
      const errMsg =
        "AnchorError caused by account: ticket. Error Code: ConstraintRaw. Error Number: 2003. Error Message: A raw constraint was violated.";
      assert.equal(err.toString(), errMsg);
    }
  });

  it("Oracle picks winner", async () => {
    // Oracle will pick second ticket [0,1]
    // number one is the second submission so player2
    let winnerIndex: number = 1;

    // Get oracle picks winner index
    await program.methods
      .pickWinner(winnerIndex)
      .accounts({
        lottery: lottery.publicKey,
        oracle: oracle.publicKey,
      })
      .signers([oracle])
      .rpc();

    // Assert that the winner index has been picked
    let lotteryState = await program.account.lottery.fetch(lottery.publicKey);
    expect(lotteryState.winnerIndex).to.equal(winnerIndex);
  });

  it("Winner withdraws funds", async () => {
    // Get winners starting balance
    let startBalance: number = await provider.connection.getBalance(
      player2.publicKey
    );

    const lotteryState = await program.account.lottery.fetch(lottery.publicKey);
    const expectedPayout = lotteryState.payout;

    // Get winner idx
    let winnerIdx: number = (
      await program.account.lottery.fetch(lottery.publicKey)
    ).winnerIndex;

    const buf1 = Buffer.alloc(4);
    buf1.writeUIntBE(winnerIdx, 0, 4);

    // Derive PDA of ticket
    const [ticket, bump] = await anchor.web3.PublicKey.findProgramAddress(
      [buf1, lottery.publicKey.toBytes()],
      program.programId
    );

    // Get lottery ticket
    await program.methods
      .payOutWinner()
      .accounts({
        ticket: ticket,
        lottery: lottery.publicKey,
        winner: player2.publicKey,
      })
      .signers([])
      .rpc();

    // Assert winner got the payout
    let endBalanace = await provider.connection.getBalance(player2.publicKey);
    expect(endBalanace).to.be.greaterThan(startBalance);

    // Verify 90% was transferred to the winner
    assert.equal(
      endBalanace - startBalance,
      expectedPayout,
      "Winner should receive 90% of the lottery balance"
    );
  });

  it("Allows the admin to withdraw the 10% holdback", async () => {
    const lotteryState = await program.account.lottery.fetch(lottery.publicKey);
    const escrowAmount = lotteryState.escrow;
    assert(escrowAmount > 0, "Escrow should have funds before withdrawal");

    // Fetch admin's initial balance
    const adminInitialBalance = await provider.connection.getBalance(lotteryAdmin.publicKey);

    // Execute withdrawal
    await program.methods.withdrawEscrow()
      .accounts({
        lottery: lottery.publicKey,
        admin: lotteryAdmin.publicKey,
      })
      .signers([lotteryAdmin])
      .rpc();

    // Fetch updated balances
    const adminFinalBalance = await provider.connection.getBalance(lotteryAdmin.publicKey);
    const updatedLottery = await program.account.lottery.fetch(lottery.publicKey);

    // Verify the escrow amount was transferred to the admin
    assert.equal(
      adminFinalBalance - adminInitialBalance,
      escrowAmount,
      "Admin should receive the full escrow amount"
    );

    // Verify escrow is now empty
    assert.equal(
      updatedLottery.escrow,
      0,
      "Escrow balance should be reset to 0 after withdrawal"
    );
  });

});
