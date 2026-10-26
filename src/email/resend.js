
import { Resend } from "resend";

function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => {
        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
        };

        return entities[character];
    });
}

export async function sendVerificationEmail({
    email,
    name,
    token,
}) {
    if (
        !process.env.RESEND_API_KEY ||
        !process.env.EMAIL_FROM ||
        !process.env.FRONTEND_URL
    ) {
        throw new Error(
            "RESEND_API_KEY, EMAIL_FROM and FRONTEND_URL must be configured"
        );
    }

    const verificationUrl = new URL(
        "/verify-email",
        process.env.FRONTEND_URL
    );

    verificationUrl.searchParams.set("token", token);

    const { error } = await new Resend(
        process.env.RESEND_API_KEY
    ).emails.send({
        from: process.env.EMAIL_FROM,
        to: [email],
        subject: "Verify your NowYours email",
        html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto">
        <h2>Welcome to NowYours!</h2>
        <p>Hi ${escapeHtml(name)},</p>
        <p>Please verify your email address to activate your account.</p>
        <p>
          <a href="${verificationUrl.toString()}"
             style="display:inline-block;padding:12px 20px;background:#111;color:white;text-decoration:none;border-radius:6px">
            Verify email
          </a>
        </p>
        <p>This link expires in 30 minutes and can only be used once.</p>
        <p>If you didn't create this account, ignore this email.</p>
      </div>
    `,
        text: `Hi ${name},

Welcome to NowYours!

Verify your email using this link:
${verificationUrl.toString()}

This link expires in 30 minutes and can only be used once.`,
    });

    if (error) {
        console.error("Resend error:", error.message);
        throw new Error("Verification email could not be sent");
    }
}


export async function sendPasswordResetEmail({
  email,
  name,
  token,
}) {
  if (
    !process.env.RESEND_API_KEY ||
    !process.env.EMAIL_FROM ||
    !process.env.FRONTEND_URL
  ) {
    throw new Error(
      "Email environment variables are not configured"
    );
  }

  const resetUrl = new URL(
    "/reset-password",
    process.env.FRONTEND_URL
  );

  resetUrl.searchParams.set("token", token);

  const safeName = name.replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[character];
  });

  const { error } = await new Resend(
    process.env.RESEND_API_KEY
  ).emails.send({
    from: process.env.EMAIL_FROM,
    to: [email],
    subject: "Reset your NowYours password",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto">
        <h2>Reset your password</h2>
        <p>Hi ${safeName},</p>
        <p>We received a request to reset your NowYours password.</p>
        <p>
          <a href="${resetUrl.toString()}"
             style="display:inline-block;padding:12px 20px;background:#111;color:#fff;text-decoration:none;border-radius:6px">
            Reset password
          </a>
        </p>
        <p>This link expires in 30 minutes and can only be used once.</p>
        <p>If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
    text: `Hi ${name},

We received a request to reset your NowYours password.

Open this link to reset it:
${resetUrl.toString()}

This link expires in 30 minutes and can only be used once.

If you didn't request this, ignore this email.`,
  });

  if (error) {
    console.error("Resend password-reset error:", error.message);
    throw new Error("Password-reset email could not be sent");
  }
}
