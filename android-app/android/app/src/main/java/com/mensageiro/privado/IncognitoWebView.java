package com.mensageiro.privado;

import android.content.Context;
import android.util.AttributeSet;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;

import com.getcapacitor.CapacitorWebView;

// Teclado anônimo (S5, D11): pede ao teclado que não aprenda nem guarde o que
// é digitado no app (o mesmo pedido do "teclado anônimo" do Signal). Teclados
// de terceiros podem ignorar o pedido; o app avisa isso em Ajustes.
public class IncognitoWebView extends CapacitorWebView {
    public IncognitoWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    public InputConnection onCreateInputConnection(EditorInfo outAttrs) {
        InputConnection ic = super.onCreateInputConnection(outAttrs);
        outAttrs.imeOptions |= EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING;
        return ic;
    }
}
